/**
 * Spec 045 T040 — pure half of the launch probe (`gateway-jwt-probe.ts`):
 * the audience listing ops paste into each gateway, and the allow/refuse
 * matrix a JWT-only socket must show. No I/O here; the CLI injects it.
 */

export interface GatewayRow {
  id: string;
  url: string;
  orgId: string | null;
}

export interface AudienceGroup {
  audience: string;
  gateways: GatewayRow[];
}

/**
 * Every distinct `gatewayAudience(row.url)`, with the rows behind it. The
 * gateway compares `aud` as an exact string, so these are pasted, never typed.
 * A row whose URL has no audience is reported, not skipped.
 */
export function listAudiences(
  rows: GatewayRow[],
  audienceOf: (url: string) => string,
): { groups: AudienceGroup[]; invalid: Array<{ row: GatewayRow; reason: string }> } {
  const byAudience = new Map<string, GatewayRow[]>();
  const invalid: Array<{ row: GatewayRow; reason: string }> = [];
  for (const row of rows) {
    let audience: string;
    try {
      audience = audienceOf(row.url);
    } catch (err) {
      invalid.push({ row, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    byAudience.set(audience, [...(byAudience.get(audience) ?? []), row]);
  }
  const groups = [...byAudience]
    .map(([audience, gateways]) => ({ audience, gateways }))
    .sort((a, b) => a.audience.localeCompare(b.audience));
  return { groups, invalid };
}

export type Outcome = 'allowed' | 'refused' | 'error' | 'skipped';

export interface ProbeCase {
  name: string;
  method: string;
  params: (jwt: string) => Record<string, unknown>;
  expect: Outcome;
}

/** Agent the probe names for the refused `sessions.patch` case; never assigned to anyone. */
export const UNASSIGNED_AGENT = 'jwt-probe-unassigned';
const PROBE_LABEL = 'jwt-probe';

/**
 * The calls a JWT-only socket makes. `auth.refresh` with the socket's own JWT is
 * the write probe: same identity, same scopes. For a member, A1's label-only
 * `sessions.patch` rule (new chat, rename) is probed on both sides: allowed for
 * an agent in the JWT's `agentIds`, refused for any other. The allowed case
 * labels one dedicated `agent:<id>:jwt-probe` session — the probe's only write.
 */
export function probeMatrix(isPlatformAdmin: boolean, assignedAgentId?: string): ProbeCase[] {
  const sessionCases: ProbeCase[] = isPlatformAdmin
    ? []
    : [
        ...(assignedAgentId
          ? [
              {
                name: 'member sessions.patch label, assigned agent',
                method: 'sessions.patch',
                params: () => ({
                  key: `agent:${assignedAgentId}:${PROBE_LABEL}`,
                  label: PROBE_LABEL,
                }),
                expect: 'allowed' as const,
              },
            ]
          : []),
        {
          name: 'member sessions.patch label, unassigned agent',
          method: 'sessions.patch',
          params: () => ({ key: `agent:${UNASSIGNED_AGENT}:${PROBE_LABEL}`, label: PROBE_LABEL }),
          expect: 'refused',
        },
      ];
  return [
    { name: 'health', method: 'health', params: () => ({}), expect: 'allowed' },
    { name: 'read (status)', method: 'status', params: () => ({}), expect: 'allowed' },
    {
      name: 'write (auth.refresh)',
      method: 'auth.refresh',
      params: (jwt) => ({ jwt }),
      expect: 'allowed',
    },
    {
      name: 'admin (config.schema)',
      method: 'config.schema',
      params: () => ({}),
      expect: isPlatformAdmin ? 'allowed' : 'refused',
    },
    ...sessionCases,
  ];
}

/** A scope or permission refusal, as opposed to any other failure. */
export function classifyError(err: unknown): Outcome {
  const message = err instanceof Error ? err.message : String(err);
  return /missing scope|forbidden|unauthori[sz]ed|access denied/i.test(message)
    ? 'refused'
    : 'error';
}

export interface ProbeSocket {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

/** How a connect attempt ended: admitted, or the gateway's close frame. */
export type ConnectOutcome = { admitted: true } | { admitted: false; code: number; reason: string };

export interface ProbeDeps {
  /** Mint server-side for the probed user and org; never printed. */
  mint(audience: string): Promise<string>;
  /** The JWT's `agentIds` claim (decoded, not verified). */
  agentIds(jwt: string): string[];
  /** JWT-only connect (no shared token). Rejects when the gateway refuses the socket. */
  connect(jwt: string): Promise<ProbeSocket>;
  /** JWT-only connect that reports the close frame; rejects on timeout or network error. */
  connectOutcome(jwt: string): Promise<ConnectOutcome>;
}

/** The gateway's refusal of an `aud` it does not serve: a 1008 close with this reason. */
export function isAudienceRefusal(outcome: ConnectOutcome): boolean {
  return (
    !outcome.admitted &&
    outcome.code === 1008 &&
    /^(jwt_audience_not_allowed|jwt_validation_failed)$/.test(outcome.reason)
  );
}

export interface ProbeLine {
  name: string;
  expected: Outcome;
  actual: Outcome;
  detail?: string;
}

/** Audience a JWT is minted for to prove cross-gateway replay is refused. */
export const FOREIGN_AUDIENCE = 'gw:jwt-probe-foreign-audience.invalid';

function detailOf(err: unknown): string {
  // Gateway error messages carry no credential; keep them short anyway.
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}

export async function runProbe(opts: {
  audience: string;
  isPlatformAdmin: boolean;
  deps: ProbeDeps;
}): Promise<{ lines: ProbeLine[]; ok: boolean }> {
  const { audience, isPlatformAdmin, deps } = opts;
  const lines: ProbeLine[] = [];

  const jwt = await deps.mint(audience);
  let socket: ProbeSocket | null = null;
  try {
    socket = await deps.connect(jwt);
    lines.push({ name: 'JWT-only connect', expected: 'allowed', actual: 'allowed' });
  } catch (err) {
    lines.push({
      name: 'JWT-only connect',
      expected: 'allowed',
      actual: classifyError(err),
      detail: detailOf(err),
    });
  }
  if (socket) {
    try {
      const assigned = deps.agentIds(jwt)[0];
      if (!isPlatformAdmin && !assigned) {
        lines.push({
          name: 'member sessions.patch label, assigned agent',
          expected: 'allowed',
          actual: 'skipped',
          detail: 'this user has no agent in the JWT; new chat and rename will fail for them',
        });
      }
      for (const probe of probeMatrix(isPlatformAdmin, assigned)) {
        try {
          await socket.call(probe.method, probe.params(jwt));
          lines.push({ name: probe.name, expected: probe.expect, actual: 'allowed' });
        } catch (err) {
          lines.push({
            name: probe.name,
            expected: probe.expect,
            actual: classifyError(err),
            detail: detailOf(err),
          });
        }
      }
    } finally {
      socket.close();
    }
  }

  // Only the gateway's audience refusal counts; a timeout or network error is a FAIL.
  const foreign = await deps.mint(FOREIGN_AUDIENCE);
  try {
    const outcome = await deps.connectOutcome(foreign);
    lines.push({
      name: 'foreign-audience connect',
      expected: 'refused',
      actual: isAudienceRefusal(outcome) ? 'refused' : outcome.admitted ? 'allowed' : 'error',
      detail: outcome.admitted
        ? undefined
        : `close ${outcome.code}: ${outcome.reason.slice(0, 120)}`,
    });
  } catch (err) {
    lines.push({
      name: 'foreign-audience connect',
      expected: 'refused',
      actual: 'error',
      detail: detailOf(err),
    });
  }

  return {
    lines,
    ok: lines.every((line) => line.actual === 'skipped' || line.actual === line.expected),
  };
}
