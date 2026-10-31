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

export type Outcome = 'allowed' | 'refused' | 'error';

export interface ProbeCase {
  name: string;
  method: string;
  params: (jwt: string) => Record<string, unknown>;
  expect: Outcome;
}

/**
 * The calls a JWT-only socket makes, each side-effect free. `auth.refresh`
 * with the socket's own JWT is the write probe: same identity, same scopes.
 */
export function probeMatrix(isPlatformAdmin: boolean): ProbeCase[] {
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

export interface ProbeDeps {
  /** Mint server-side for the probed user and org; never printed. */
  mint(audience: string): Promise<string>;
  /** JWT-only connect (no shared token). Rejects when the gateway refuses the socket. */
  connect(jwt: string): Promise<ProbeSocket>;
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
      for (const probe of probeMatrix(isPlatformAdmin)) {
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

  // Any refusal of the socket counts: the gateway closes 1008 on an unlisted `aud`.
  const foreign = await deps.mint(FOREIGN_AUDIENCE);
  try {
    const replay = await deps.connect(foreign);
    replay.close();
    lines.push({ name: 'foreign-audience connect', expected: 'refused', actual: 'allowed' });
  } catch (err) {
    lines.push({
      name: 'foreign-audience connect',
      expected: 'refused',
      actual: 'refused',
      detail: detailOf(err),
    });
  }

  return { lines, ok: lines.every((line) => line.actual === line.expected) };
}
