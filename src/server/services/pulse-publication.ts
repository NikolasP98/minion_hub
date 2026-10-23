import { and, eq } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import { pulseProposals } from '$server/db/pg-schema/pulse';
import { pulseHash } from './pulse-action-contract';
import { canonicalJson } from './pulse-ingest-contract';
import type { DigestResult } from './pulse-digest.reasoning';
import type { DigestSnapshot } from './pulse-digest.sources';
export const DIGEST_INTERNAL_PREFIX = 'internal:dependency-digest:v1:';
export type InternalPulseInput = {
  runId: string;
  policyRevision: string;
  inputHash: string;
  resultHash: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
};
export function internalContentHash(
  input: Pick<InternalPulseInput, 'title' | 'summary' | 'payload'>,
): string {
  return pulseHash(input);
}
export function digestCardPayload(
  result: DigestResult,
  snapshot: DigestSnapshot,
): Record<string, unknown> {
  return {
    digest: {
      claim: result.claim,
      relevance: result.relevance,
      nextStep: result.nextStep,
      citations: result.citations.map((c) => {
        const e = snapshot.evidence.find(
          (e) =>
            e.sourceId === c.sourceId &&
            e.contentHash === c.contentHash &&
            e.dependency.package === c.package &&
            e.dependency.file === c.file,
        );
        if (!e) throw new Error('digest_citation_binding');
        return { ...c, url: e.url, version: e.version, dependency: e.dependency };
      }),
    },
  };
}
/** Caller owns transaction, owner RLS and job generation. No network, no nested commit. */
export async function insertInternalPulseProposalTx(
  tx: CoreTx,
  scope: { tenantId: string; profileId: string },
  input: InternalPulseInput,
): Promise<{ cardId: string; existing: boolean }> {
  if (
    input.title.length < 1 ||
    input.title.length > 500 ||
    input.summary.length > 4000 ||
    Buffer.byteLength(canonicalJson(input.payload)) > 16384 ||
    'tool' in input.payload ||
    'args' in input.payload
  )
    throw new Error('digest_card_bounds');
  const dedupKey = DIGEST_INTERNAL_PREFIX + input.runId;
  const expected = {
    orgId: scope.tenantId,
    ownerProfileId: scope.profileId,
    source: 'dependency-digest',
    kind: 'digest',
    title: input.title,
    summary: input.summary,
    payload: input.payload,
    dedupKey,
    revision: 1,
    internalRunId: input.runId,
    internalPolicyRevision: input.policyRevision,
    internalInputHash: input.inputHash,
    internalResultHash: input.resultHash,
  };
  const inserted = await tx
    .insert(pulseProposals)
    .values(expected)
    .onConflictDoNothing({ target: [pulseProposals.orgId, pulseProposals.dedupKey] })
    .returning({ id: pulseProposals.id });
  const [row] = await tx
    .select()
    .from(pulseProposals)
    .where(and(eq(pulseProposals.orgId, scope.tenantId), eq(pulseProposals.dedupKey, dedupKey)))
    .for('update');
  if (
    !row ||
    pulseHash(
      Object.fromEntries(Object.keys(expected).map((k) => [k, row[k as keyof typeof row]])),
    ) !== pulseHash(expected)
  )
    throw new Error('digest_card_binding_conflict');
  return { cardId: row.id, existing: inserted.length === 0 };
}
