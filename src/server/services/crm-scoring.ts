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
  /** outbound is derived: messageCount - inboundCount */
  firstContactAt: Date | null;
  lastContactAt: Date | null;
}

/** Days between `from` and `now` (fractional). Returns Infinity if `from` is null. */
function daysSince(from: Date | null, now: Date): number {
  if (!from) return Infinity;
  return (now.getTime() - from.getTime()) / 86_400_000;
}

/**
 * Derive a lifecycle stage from ledger-rollup signals (spec §5). Thresholds:
 * New <7d & <3 msgs · Engaged ≤14d & two-way · Active ≤30d & ≥10 msgs ·
 * Dormant 30–90d · Churned >90d. Order matters — first match wins.
 */
export function deriveLifecycleStage(stats: ContactStats, now: Date = new Date()): LifecycleStage {
  // No tracked interactions yet (manual/imported contact) → New, not Churned.
  // "Churned" means previously engaged then went silent; a zero-message contact
  // was never engaged via a tracked channel.
  if (stats.messageCount === 0) return 'New';

  const lastDays = daysSince(stats.lastContactAt, now);
  const firstDays = daysSince(stats.firstContactAt, now);
  const outbound = stats.messageCount - stats.inboundCount;

  if (lastDays > 90) return 'Churned';
  if (lastDays > 30) return 'Dormant';
  if (lastDays <= 30 && stats.messageCount >= 10) return 'Active';
  if (lastDays <= 14 && stats.inboundCount >= 1 && outbound >= 1) return 'Engaged';
  if (firstDays < 7 && stats.messageCount < 3) return 'New';
  // Falls between buckets (e.g. recent but one-way, low volume) → treat as Engaged
  // if contacted within 30d, else Dormant.
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
