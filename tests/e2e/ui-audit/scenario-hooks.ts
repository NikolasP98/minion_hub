import type { APIRequestContext } from '@playwright/test';
import type { ResolvedCaptureRoute } from '../../../src/lib/routes/capture-route-resolver';

export type ScenarioPreparationMethod =
  'natural-public' | 'seeded-read-only' | 'persona-access-policy' | 'external-disposable-provider';

export interface ScenarioPreparation {
  status: 'prepared' | 'blocked';
  method?: ScenarioPreparationMethod;
  reason?: string;
}

export class CaptureScenarioBlockedError extends Error {
  readonly preparation: ScenarioPreparation;

  constructor(reason: string) {
    super(reason);
    this.name = 'CaptureScenarioBlockedError';
    this.preparation = { status: 'blocked', reason };
  }
}

function isLoopbackUrl(raw: string): boolean {
  const hostname = new URL(raw).hostname;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === 'supabase' ||
    hostname.endsWith('.local')
  );
}

export function validateScenarioEndpoint(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (!isLoopbackUrl(raw)) {
    throw new Error(
      `Refusing UI-audit scenario provider on non-local host ${url.hostname}; state preparation may only mutate a disposable local service.`,
    );
  }
  return url.toString();
}

export function resolveBuiltInScenarioPreparation(
  entry: ResolvedCaptureRoute,
): ScenarioPreparation {
  if (entry.state === 'default' && entry.persona === 'anonymous') {
    return { status: 'prepared', method: 'natural-public' };
  }
  if (entry.state === 'default' || entry.state === 'populated') {
    return { status: 'prepared', method: 'seeded-read-only' };
  }
  if (
    entry.state === 'forbidden' &&
    (entry.persona === 'restricted-no-module' || entry.persona === 'member-viewer')
  ) {
    return { status: 'prepared', method: 'persona-access-policy' };
  }
  if (
    entry.state === 'complete' &&
    (entry.pattern.endsWith('/complete') || entry.pattern === '/join/sent')
  ) {
    return {
      status: 'prepared',
      method: entry.persona === 'anonymous' ? 'natural-public' : 'seeded-read-only',
    };
  }
  return {
    status: 'blocked',
    reason: `State ${entry.state} for ${entry.pattern} requires the disposable scenario provider or a route-specific simulator fixture.`,
  };
}

interface ProviderResponse {
  status?: 'prepared' | 'blocked';
  reason?: string;
}

export class CaptureScenarioHooks {
  readonly endpoint: string | undefined;
  private readonly request: APIRequestContext;
  private readonly preparations = new Map<string, ScenarioPreparation>();

  constructor(request: APIRequestContext, endpoint = process.env.E2E_UI_AUDIT_SCENARIO_ENDPOINT) {
    this.request = request;
    this.endpoint = validateScenarioEndpoint(endpoint);
  }

  preparationFor(entry: ResolvedCaptureRoute): ScenarioPreparation | undefined {
    return this.preparations.get(entry.scenarioKey);
  }

  async prepare(entry: ResolvedCaptureRoute): Promise<void> {
    if (!this.endpoint) {
      const preparation = resolveBuiltInScenarioPreparation(entry);
      this.preparations.set(entry.scenarioKey, preparation);
      if (preparation.status === 'blocked') {
        throw new CaptureScenarioBlockedError(preparation.reason ?? 'Scenario is blocked.');
      }
      return;
    }

    const response = await this.request.post(this.endpoint, { data: entry });
    let body: ProviderResponse = {};
    try {
      body = (await response.json()) as ProviderResponse;
    } catch {
      // Status and response text below still produce a deterministic blocker.
    }
    if (!response.ok() || body.status === 'blocked') {
      const reason =
        body.reason ??
        `Disposable scenario provider rejected ${entry.scenarioKey}: ${response.status()} ${await response.text()}`;
      const preparation = { status: 'blocked', reason } as const;
      this.preparations.set(entry.scenarioKey, preparation);
      throw new CaptureScenarioBlockedError(reason);
    }
    this.preparations.set(entry.scenarioKey, {
      status: 'prepared',
      method: 'external-disposable-provider',
    });
  }

  async reset(entry: ResolvedCaptureRoute): Promise<void> {
    if (!this.endpoint) return;
    const response = await this.request.delete(this.endpoint, { data: entry });
    if (!response.ok()) {
      throw new Error(
        `Disposable scenario reset failed for ${entry.scenarioKey}: ${response.status()} ${await response.text()}`,
      );
    }
  }
}
