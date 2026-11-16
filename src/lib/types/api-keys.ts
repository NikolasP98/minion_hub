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
}
