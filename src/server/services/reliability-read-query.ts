const DAY_MS = 86_400_000;
const MAX_RANGE_MS = 90 * DAY_MS;
const FUTURE_SKEW_MS = 60_000;

export class ReliabilityReadQueryError extends Error {
  readonly status = 400;
  constructor(readonly code: string) {
    super('Invalid reliability read query');
    this.name = 'ReliabilityReadQueryError';
  }
}

function exactParams(url: URL, allowed: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new ReliabilityReadQueryError('unknown_parameter');
    if (seen.has(key)) throw new ReliabilityReadQueryError('duplicate_parameter');
    seen.add(key);
  }
}

function requiredServerId(url: URL): string {
  const value = url.searchParams.get('serverId');
  if (value === null || value.length === 0 || value.length > 256 || value.trim() !== value) {
    throw new ReliabilityReadQueryError('invalid_server_id');
  }
  return value;
}

function safeInteger(raw: string | null, fallback: number, code: string): number {
  if (raw === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(raw)) throw new ReliabilityReadQueryError(code);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new ReliabilityReadQueryError(code);
  return value;
}

function range(url: URL, now: number): { from: number; to: number } {
  const to = safeInteger(url.searchParams.get('to'), now, 'invalid_to');
  const from = safeInteger(
    url.searchParams.get('from'),
    Math.max(0, to - 7 * DAY_MS),
    'invalid_from',
  );
  if (from > to) throw new ReliabilityReadQueryError('invalid_range_order');
  if (to > now + FUTURE_SKEW_MS) throw new ReliabilityReadQueryError('range_in_future');
  if (to - from > MAX_RANGE_MS) throw new ReliabilityReadQueryError('range_too_wide');
  return { from, to };
}

function boundedLimit(raw: string | null, fallback: number): number {
  const value = safeInteger(raw, fallback, 'invalid_limit');
  if (value < 1 || value > 2000) throw new ReliabilityReadQueryError('invalid_limit');
  return value;
}

export interface InsightsReadQuery {
  serverId: string;
  from: number;
  to: number;
}

export function parseInsightsReadQuery(url: URL, now = Date.now()): InsightsReadQuery {
  exactParams(url, new Set(['serverId', 'from', 'to']));
  return { serverId: requiredServerId(url), ...range(url, now) };
}

export interface SkillStatsReadQuery extends InsightsReadQuery {
  skillName?: string;
  limit: number;
  summary: boolean;
}

export function parseSkillStatsReadQuery(url: URL, now = Date.now()): SkillStatsReadQuery {
  exactParams(url, new Set(['serverId', 'from', 'to', 'skillName', 'limit', 'summary']));
  const summaryRaw = url.searchParams.get('summary');
  if (summaryRaw !== null && summaryRaw !== 'true' && summaryRaw !== 'false') {
    throw new ReliabilityReadQueryError('invalid_summary');
  }
  const skillNameRaw = url.searchParams.get('skillName');
  if (skillNameRaw !== null && (skillNameRaw.length === 0 || skillNameRaw.length > 256)) {
    throw new ReliabilityReadQueryError('invalid_skill_name');
  }
  return {
    serverId: requiredServerId(url),
    ...range(url, now),
    ...(skillNameRaw === null ? {} : { skillName: skillNameRaw }),
    limit: boundedLimit(url.searchParams.get('limit'), 200),
    summary: summaryRaw === 'true',
  };
}

export interface CredentialHealthReadQuery extends InsightsReadQuery {
  limit: number;
}

export function parseCredentialHealthReadQuery(
  url: URL,
  now = Date.now(),
): CredentialHealthReadQuery {
  exactParams(url, new Set(['serverId', 'from', 'to', 'limit']));
  return {
    serverId: requiredServerId(url),
    ...range(url, now),
    limit: boundedLimit(url.searchParams.get('limit'), 100),
  };
}

export function parseArchitectureReadQuery(url: URL): void {
  exactParams(url, new Set());
}
