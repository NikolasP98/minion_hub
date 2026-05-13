export type AliasCheck = { ok: true } | { ok: false; reason: 'invalid' | 'taken' };

const ALIAS_RE = /^[a-z0-9_]{2,32}$/;

export function validateAlias(input: string): AliasCheck {
  return ALIAS_RE.test(input) ? { ok: true } : { ok: false, reason: 'invalid' };
}

export function normalizeAlias(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}
