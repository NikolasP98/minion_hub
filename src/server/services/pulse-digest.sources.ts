import { z } from 'zod';
import { canonicalJson } from './pulse-ingest-contract';
import { pulseHash } from './pulse-action-contract';
import { fetchDigestSource, type DigestTransport } from './pulse-digest.fetch';
import type { DigestPolicy } from './pulse-digest.policy';

const releaseSchema = z.object({
  html_url: z.string().url().max(2048),
  tag_name: z.string().min(1).max(256),
  name: z.string().max(500).nullable().optional(),
  body: z.string().max(1048576).nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});
export type DigestEvidence = {
  sourceId: string;
  url: string;
  version: string;
  title: string;
  content: string;
  contentHash: string;
  dependency: DigestPolicy['sources'][number]['dependency'];
};
export type DigestCheckpoint = {
  sourceId: string;
  revision: number;
  contentHash: string | null;
  etag: string | null;
  lastModified: string | null;
  evidence: DigestEvidence[] | null;
};
export type DigestSnapshot = {
  hash: string;
  evidence: DigestEvidence[];
  excluded?: { sourceId: string; version: string; reason: 'unmatched_dependency_tag' }[];
  sources: {
    sourceId: string;
    revision: number;
    contentHash: string;
    etag: string | null;
    lastModified: string | null;
    evidence: DigestEvidence[];
  }[];
  unchanged: boolean;
  observedAt: string;
};
export function boundDigestEvidence(evidence: DigestEvidence[]): string {
  const canonical = canonicalJson(evidence);
  if (evidence.length > 20 || Buffer.byteLength(canonical) > 49152)
    throw new Error('digest_normalized_limit');
  return canonical;
}
/** Transport is a function seam supplied by fixtures only; deployment configuration has no bypass. */
export async function collectDigestSources(
  policy: DigestPolicy,
  checkpoints: DigestCheckpoint[],
  options: { signal: AbortSignal; deadline: number },
  transport: DigestTransport = fetchDigestSource,
): Promise<DigestSnapshot> {
  if (!policy.enabled || Date.parse(policy.approval.expiresAt) <= Date.now())
    throw new Error('digest_disabled');
  const remaining = Math.min(15000, options.deadline - performance.now());
  if (remaining <= 0) throw new Error('digest_collection_deadline');
  const abort = new AbortController();
  const signal = AbortSignal.any([
    options.signal,
    abort.signal,
    AbortSignal.timeout(Math.ceil(remaining)),
  ]);
  const sources: DigestSnapshot['sources'] = [];
  const excluded: NonNullable<DigestSnapshot['excluded']> = [];
  let index = 0;
  const runner = async () => {
    while (index < policy.sources.length) {
      signal.throwIfAborted();
      const source = policy.sources[index++];
      const checkpoint = checkpoints.find((c) => c.sourceId === source.id);
      const reply = await transport(source.url, {
        signal,
        etag: checkpoint?.evidence ? checkpoint.etag : null,
        lastModified: checkpoint?.evidence ? checkpoint.lastModified : null,
      });
      signal.throwIfAborted();
      let evidence: DigestEvidence[];
      if (reply.status === 304) {
        if (
          !checkpoint?.evidence ||
          !checkpoint.contentHash ||
          pulseHash(checkpoint.evidence) !== checkpoint.contentHash
        )
          throw new Error('digest_304_without_evidence');
        if (
          checkpoint.evidence.some(
            (e) =>
              e.sourceId !== source.id || pulseHash(e.dependency) !== pulseHash(source.dependency),
          )
        )
          throw new Error('digest_304_dependency_drift');
        evidence = checkpoint.evidence;
      } else {
        const releases = z.array(releaseSchema).parse(JSON.parse(reply.body));
        if (releases.length > 20) throw new Error('digest_normalized_limit');
        evidence = releases
          .filter((r) => !r.draft && !r.prerelease)
          .filter((r) => {
            if (
              (source.id === 'ai' || source.id === 'openai') &&
              !r.tag_name.startsWith(source.dependency.package + '@')
            ) {
              excluded.push({
                sourceId: source.id,
                version: r.tag_name,
                reason: 'unmatched_dependency_tag',
              });
              return false;
            }
            return true;
          })
          .map((r) => {
            const url = new URL(r.html_url);
            const official = new URL(source.url).pathname
              .replace(/^\/repos\//, '/')
              .replace(/\/releases$/, '');
            if (
              url.protocol !== 'https:' ||
              url.hostname !== 'github.com' ||
              !url.pathname.startsWith(official + '/releases/') ||
              url.username ||
              url.password ||
              url.hash ||
              url.port
            )
              throw new Error('digest_evidence_url');
            const content = (r.body ?? '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
            return {
              sourceId: source.id,
              url: url.href,
              version: r.tag_name.normalize('NFC'),
              title: (r.name ?? r.tag_name).normalize('NFC').trim(),
              content,
              contentHash: pulseHash(content),
              dependency: source.dependency,
            };
          })
          .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), 'en'));
      }
      boundDigestEvidence(evidence);
      sources.push({
        sourceId: source.id,
        revision: checkpoint?.revision ?? 0,
        contentHash: pulseHash(evidence),
        etag: reply.status === 304 ? checkpoint!.etag : reply.etag,
        lastModified: reply.status === 304 ? checkpoint!.lastModified : reply.lastModified,
        evidence,
      });
    }
  };
  const work = [runner(), runner()];
  try {
    await Promise.all(work);
  } catch (e) {
    abort.abort();
    await Promise.allSettled(work);
    throw e;
  }
  signal.throwIfAborted();
  sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId, 'en'));
  const evidence = sources.flatMap((s) => s.evidence);
  boundDigestEvidence(evidence);
  if (
    evidence.length + excluded.length > 20 ||
    Buffer.byteLength(canonicalJson(evidence)) +
      (excluded.length ? Buffer.byteLength(canonicalJson(excluded)) : 0) >
      49152
  )
    throw new Error('digest_normalized_limit');
  const hash = pulseHash(sources.map((s) => ({ sourceId: s.sourceId, evidence: s.evidence })));
  return {
    hash,
    evidence,
    excluded: excluded.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), 'en')),
    sources,
    unchanged: sources.every(
      (s) => checkpoints.find((c) => c.sourceId === s.sourceId)?.contentHash === s.contentHash,
    ),
    observedAt: new Date().toISOString(),
  };
}
