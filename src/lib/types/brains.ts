// Client-safe view types for the AI-Brains feature — mirror the shapes
// `brains.service.ts` (server-only) returns, without importing the Drizzle
// schema into client bundles. SvelteKit's devalue serializer preserves Date
// instances across the load boundary, so timestamps stay `Date` here too.

export interface BrainDTO {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  icon: string | null;
  visibility: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Known values for these columns — documentation only. The DTO fields below
// stay plain `string` because Drizzle's `.$inferSelect` widens unconstrained
// `text()` columns to `string`, and that's the actual shape `+page.server.ts`
// loads pass through (no runtime narrowing) — a literal union here would only
// be true in our heads, not in the type checker's.
export type BrainDocumentSourceType = 'note' | 'url' | 'upload' | 'module_ref';
export type BrainDocumentStatus = 'pending' | 'ingesting' | 'ready' | 'failed';

export interface BrainDocumentDTO {
  id: string;
  brainId: string;
  orgId: string;
  title: string;
  sourceType: string;
  sourceRef: string | null;
  contentMd: string | null;
  status: string;
  error: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrainAccessRowDTO {
  brainId: string;
  orgId: string;
  principalType: string;
  principalId: string;
  level: string;
}

export interface BrainSearchHitDTO {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  seq: number;
  chunkText: string;
  score: number;
}
