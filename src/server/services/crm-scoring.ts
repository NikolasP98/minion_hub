/**
 * CRM scoring + lifecycle + auto-tag rule compilation (spec §5–7).
 *
 * Pure, DB-agnostic logic. The RFM score itself is computed in SQL (single
 * source of truth for ranking + sorting), but the WEIGHTS and the lifecycle
 * derivation live here so the service and the UI explainability tooltip agree,
 * and so the security-sensitive auto-tag rule compiler is unit-testable.
 */

/** RFM component weights — score = w.r·R + w.f·F + w.m·M (each component 0–100). */
export const RFM_WEIGHTS = { r: 0.5, f: 0.3, m: 0.2 } as const;

/** Saturation constants used by both the SQL expressions and the TeX label. */
export const RFM_CONST = {
  recencyHalfLifeDays: 30, // R = 100·exp(-last_days/30)
  freqSaturationMsgs: 20, // F = 100·ln(1+inbound)/ln(1+20)
  volSaturationMsgs: 50, // M volume term saturates ~50
  channelTarget: 3, // M channel-diversity term caps at 3 distinct channels
} as const;

export type LifecycleStage = 'New' | 'Engaged' | 'Active' | 'Dormant' | 'Churned';
export const LIFECYCLE_STAGES: LifecycleStage[] = [
  'New',
  'Engaged',
  'Active',
  'Dormant',
  'Churned',
];

export interface ContactStats {
  messageCount: number;
  inboundCount: number;
  /** Effective FIRST interaction = earliest of {first message, first purchase}. */
  firstContactAt: Date | null;
  /** Effective LAST interaction = latest of {last message, last purchase}. */
  lastContactAt: Date | null;
  /** Has a prior paying/booking relationship (any finance invoice). */
  isBuyer?: boolean;
}

/** Days between `from` and `now` (fractional). Returns Infinity if `from` is null. */
function daysSince(from: Date | null, now: Date): number {
  if (!from) return Infinity;
  return (now.getTime() - from.getTime()) / 86_400_000;
}

/**
 * Derive a lifecycle stage from EFFECTIVE interaction signals (spec §5) — recency
 * is the latest of {message, purchase}, so a prior buyer is never mislabelled
 * "New". Thresholds: New = first-ever <7d & <3 msgs & never bought · Engaged ≤14d
 * & recent inbound · Active ≤30d & ≥10 msgs · Dormant 30–90d · Churned >90d.
 * Order matters — first match wins. MUST mirror the SQL CASE in rankContacts.
 */
export function deriveLifecycleStage(stats: ContactStats, now: Date = new Date()): LifecycleStage {
  const isBuyer = stats.isBuyer ?? false;
  // Pure cold record: never messaged AND never bought → genuinely New (not Churned;
  // "Churned" means previously engaged then went silent).
  if (stats.messageCount === 0 && !isBuyer) return 'New';

  const lastDays = daysSince(stats.lastContactAt, now);
  const firstDays = daysSince(stats.firstContactAt, now);

  if (lastDays > 90) return 'Churned';
  if (lastDays > 30) return 'Dormant';
  if (lastDays <= 30 && stats.messageCount >= 10) return 'Active';
  // Engaged: recent inbound. The two-way (outbound ≥ 1) requirement was dropped —
  // when the org rarely replies in-channel it buried every one-message lead in New.
  if (lastDays <= 14 && stats.inboundCount >= 1) return 'Engaged';
  if (firstDays < 7 && stats.messageCount < 3 && !isBuyer) return 'New';
  // Falls between buckets (e.g. a quiet recent contact) → Engaged if within 30d, else Dormant.
  return lastDays <= 30 ? 'Engaged' : 'Dormant';
}

/** Effective stage: a manual override always wins over the derived stage. */
export function effectiveStage(
  override: string | null | undefined,
  stats: ContactStats,
  now: Date = new Date(),
): string {
  return override && override.length > 0 ? override : deriveLifecycleStage(stats, now);
}

// ── Auto-tag rule compiler (spec §7) ─────────────────────────────────────────
// An auto-tag rule is a small predicate over the computed ranking row. It is
// compiled to a SQL boolean fragment and evaluated LIVE in the ranking query.
// SECURITY: the `field` is whitelisted to ranking-row columns (so it can never
// inject a column/expression); numeric values become numeric literals; string
// values are single-quote-escaped; only a fixed operator set is allowed.

/** Columns the ranking query exposes, with their type, that a rule may filter. */
export const RULE_FIELDS = {
  score: 'number',
  r_score: 'number',
  f_score: 'number',
  m_score: 'number',
  last_days: 'number',
  total_msgs: 'number',
  inbound_msgs: 'number',
  channels_used: 'number',
  reciprocity: 'number',
  stage: 'string',
} as const;
export type RuleField = keyof typeof RULE_FIELDS;

const NUMERIC_OPS = new Set(['=', '!=', '>', '>=', '<', '<=']);
const STRING_OPS = new Set(['=', '!=']);

export interface LeafRule {
  field: RuleField;
  op: string;
  value: number | string | boolean;
}
export interface AllRule {
  all: TagRule[];
}
export interface AnyRule {
  any: TagRule[];
}
export type TagRule = LeafRule | AllRule | AnyRule;

export class TagRuleError extends Error {}

function escapeStringLiteral(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function compileLeaf(rule: LeafRule): string {
  const type = RULE_FIELDS[rule.field];
  if (!type) throw new TagRuleError(`Unknown rule field: ${String(rule.field)}`);
  const ops = type === 'number' ? NUMERIC_OPS : STRING_OPS;
  if (!ops.has(rule.op)) throw new TagRuleError(`Operator '${rule.op}' not allowed for ${rule.field}`);

  let literal: string;
  if (type === 'number') {
    const n = typeof rule.value === 'number' ? rule.value : Number(rule.value);
    if (!Number.isFinite(n)) throw new TagRuleError(`Non-numeric value for ${rule.field}: ${rule.value}`);
    literal = String(n);
  } else {
    if (typeof rule.value !== 'string') throw new TagRuleError(`Non-string value for ${rule.field}`);
    literal = escapeStringLiteral(rule.value);
  }
  // field is whitelisted → safe to interpolate as a bare identifier.
  return `(${rule.field} ${rule.op} ${literal})`;
}

/**
 * Compile an auto-tag rule to a SQL boolean fragment over the ranking row.
 * Throws `TagRuleError` on any unknown field / disallowed op / bad value —
 * callers treat a non-compilable rule as "never matches", never as injection.
 * Returns a string suitable for embedding in a WHERE/SELECT boolean position.
 */
export function compileTagRule(rule: TagRule, depth = 0): string {
  if (depth > 8) throw new TagRuleError('Rule nesting too deep');
  if (rule && typeof rule === 'object' && 'all' in rule) {
    if (!Array.isArray(rule.all) || rule.all.length === 0) throw new TagRuleError('Empty "all" group');
    return `(${rule.all.map((r) => compileTagRule(r, depth + 1)).join(' and ')})`;
  }
  if (rule && typeof rule === 'object' && 'any' in rule) {
    if (!Array.isArray(rule.any) || rule.any.length === 0) throw new TagRuleError('Empty "any" group');
    return `(${rule.any.map((r) => compileTagRule(r, depth + 1)).join(' or ')})`;
  }
  if (rule && typeof rule === 'object' && 'field' in rule) {
    return compileLeaf(rule as LeafRule);
  }
  throw new TagRuleError('Malformed rule node');
}

/** Safe wrapper: returns the SQL fragment, or null if the rule is invalid. */
export function tryCompileTagRule(rule: unknown): string | null {
  try {
    return compileTagRule(rule as TagRule);
  } catch {
    return null;
  }
}

// ── Auto-tag rule evaluation (in-process mirror of the SQL compiler) ──────────
// The SQL compiler above evaluates rules LIVE inside the ranking query. But the
// list/detail pages already hold the fully-scored ranking ROW in memory, so we
// also evaluate the same rule shape directly against that row — this is what
// actually surfaces an auto-tag as "applied" in the UI (chips on the detail
// panel, the tag filter on the list). Same whitelist + operator set as the
// compiler, so the two never disagree; an invalid rule simply never matches.

const NUMERIC_CMP: Record<string, (a: number, b: number) => boolean> = {
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
};

/** A scored ranking row (the fields a rule may read). */
export type RankingRow = Partial<Record<RuleField, number | string | null>>;

function evalLeaf(rule: LeafRule, row: RankingRow): boolean {
  const type = RULE_FIELDS[rule.field];
  if (!type) return false;
  const ops = type === 'number' ? NUMERIC_OPS : STRING_OPS;
  if (typeof rule.op !== 'string' || !ops.has(rule.op)) return false;
  const actual = row[rule.field];
  if (type === 'number') {
    const a = typeof actual === 'number' ? actual : Number(actual);
    const b = typeof rule.value === 'number' ? rule.value : Number(rule.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return NUMERIC_CMP[rule.op](a, b);
  }
  const a = actual == null ? '' : String(actual);
  const b = typeof rule.value === 'string' ? rule.value : String(rule.value ?? '');
  return rule.op === '=' ? a === b : a !== b;
}

/**
 * Evaluate an auto-tag rule against a scored ranking row. Returns false for any
 * malformed / out-of-whitelist rule (never throws) — mirrors `tryCompileTagRule`.
 */
export function evaluateTagRule(rule: unknown, row: RankingRow, depth = 0): boolean {
  if (depth > 8 || !rule || typeof rule !== 'object') return false;
  const r = rule as Record<string, unknown>;
  if ('all' in r) {
    return Array.isArray(r.all) && r.all.length > 0 && r.all.every((x) => evaluateTagRule(x, row, depth + 1));
  }
  if ('any' in r) {
    return Array.isArray(r.any) && r.any.length > 0 && r.any.some((x) => evaluateTagRule(x, row, depth + 1));
  }
  if ('field' in r) return evalLeaf(r as unknown as LeafRule, row);
  return false;
}

/** A tag definition with an optional auto-rule (the shape `listTags` returns). */
export interface TagWithRule {
  id: string;
  kind?: string | null;
  rule?: unknown;
}

/** The ids of every auto-tag whose rule matches the given scored row. */
export function matchingAutoTagIds(row: RankingRow, tags: TagWithRule[]): string[] {
  return tags
    .filter((t) => t.kind === 'auto' && t.rule != null && evaluateTagRule(t.rule, row))
    .map((t) => t.id);
}
