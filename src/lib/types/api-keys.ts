/** An organization API key as an admin sees it (spec 121). Never the hash, never the text. */
export interface ApiKeyRow {
  id: string;
  name: string;
  /** 8 hex characters; shown as `mk_<prefix>_…`. */
  prefix: string;
  createdAt: string;
  /** Null when the person no longer exists. */
  createdByName: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  /** Abilities beyond doors; `sandbox` = the MCP endpoint (spec 136), `locks` = the record-lock webhook (spec 140). Empty for older keys. */
  scopes: ApiKeyScope[];
}

export const API_KEY_SCOPES = ['sandbox', 'locks'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
