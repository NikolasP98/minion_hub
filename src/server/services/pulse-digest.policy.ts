import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pulseHash } from './pulse-action-contract';
import { createHash } from 'node:crypto';
import dependencySnapshot from '$server/pulse/dependency-snapshot.json';
import frozenManifest from '../../../package.json?raw';
import frozenLock from '../../../bun.lock?raw';
import { readPulseWorkerScope } from './pulse-worker-config';

/** Repository-managed official release APIs. Item URLs are evidence, never fetch targets. */
export const DIGEST_OFFICIAL_SOURCES = Object.freeze({
  sveltekit: {
    package: '@sveltejs/kit',
    url: 'https://api.github.com/repos/sveltejs/kit/releases?per_page=4',
  },
  svelte: {
    package: 'svelte',
    url: 'https://api.github.com/repos/sveltejs/svelte/releases?per_page=4',
  },
  ai: { package: 'ai', url: 'https://api.github.com/repos/vercel/ai/releases?per_page=4' },
  openai: {
    package: '@ai-sdk/openai',
    url: 'https://api.github.com/repos/vercel/ai/releases?per_page=4',
  },
  supabase: {
    package: '@supabase/supabase-js',
    url: 'https://api.github.com/repos/supabase/supabase-js/releases?per_page=4',
  },
});
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const anchor = z
  .object({
    package: z.string().min(1).max(128),
    version: z.string().min(1).max(128),
    file: z.literal('package.json'),
    fileHash: hash,
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    lockFile: z.literal('bun.lock'),
    lockHash: hash,
  })
  .strict();
const source = z
  .object({
    id: z.enum(['sveltekit', 'svelte', 'ai', 'openai', 'supabase']),
    url: z.string().url(),
    dependency: anchor,
  })
  .strict()
  .superRefine((s, ctx) => {
    const official = DIGEST_OFFICIAL_SOURCES[s.id];
    if (s.url !== official.url || s.dependency.package !== official.package)
      ctx.addIssue({ code: 'custom', message: 'Official source/dependency mismatch' });
  });
export const digestPolicySchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    tenantId: z.string().uuid(),
    ownerProfileId: z.string().uuid(),
    revision: z.string().min(1).max(128),
    budgetNamespace: z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,127}$/),
    locale: z.enum(['en', 'es']),
    sources: z.array(source).min(1).max(5),
    maxItems: z.literal(20),
    maxInputBytes: z.literal(49152),
    maxCallsPerDay: z.number().int().min(0).max(5),
    maxOutputTokens: z.literal(1024),
    timeoutMs: z.literal(30000),
    model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9./:_-]{0,199}$/),
    provider: z.literal('openrouter-chat-v1'),
    approval: z
      .object({
        reference: z.string().min(1).max(512),
        revision: z.string().min(1).max(128),
        expiresAt: z.string().datetime(),
        pricingRevision: z.string().min(1).max(128),
        upperMicroUsd: money,
        dailyMicroUsd: money,
        outputBound: z.literal('chat-max-tokens-v1'),
        fallbackBound: z.literal('allow-fallbacks-false-v1'),
      })
      .strict(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.sources.map((s) => s.id)).size !== p.sources.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate source' });
    if (p.approval.upperMicroUsd > p.approval.dailyMicroUsd)
      ctx.addIssue({ code: 'custom', message: 'Exposure exceeds daily limit' });
  });
export type DigestPolicy = Readonly<z.infer<typeof digestPolicySchema>>;
const retainedScopeSchema = z
  .object({ tenantId: z.string().uuid(), ownerProfileId: z.string().uuid() })
  .strict();
export type DigestScope = Readonly<z.infer<typeof retainedScopeSchema>>;
/** Retained across policy deletion/rollback; never inferred from storage or request data. */
export function readDigestScope(): DigestScope | null {
  const raw = process.env.MINION_PULSE_DIGEST_SCOPE;
  const worker = readPulseWorkerScope();
  try {
    if (raw !== undefined && Buffer.byteLength(raw) > 1024) return null;
    const explicit = raw !== undefined ? retainedScopeSchema.parse(JSON.parse(raw)) : null;
    const inherited = worker
      ? retainedScopeSchema.parse({
          tenantId: worker.tenantId,
          ownerProfileId: worker.ownerProfileId,
        })
      : null;
    if (
      explicit &&
      inherited &&
      (explicit.tenantId !== inherited.tenantId ||
        explicit.ownerProfileId !== inherited.ownerProfileId)
    )
      return null;
    return explicit ? Object.freeze(explicit) : inherited ? Object.freeze(inherited) : null;
  } catch {
    return null;
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export function parseDigestPolicy(input: unknown): DigestPolicy {
  return freeze(digestPolicySchema.parse(input));
}
export function readDigestPolicy(includeDisabled = false): DigestPolicy | null {
  const raw = process.env.MINION_PULSE_DIGEST_POLICY;
  if (!raw || Buffer.byteLength(raw) > 16384) return null;
  try {
    const p = parseDigestPolicy(JSON.parse(raw));
    const scope = readDigestScope();
    return includeDisabled ||
      (p.enabled &&
        Date.parse(p.approval.expiresAt) > Date.now() &&
        scope?.tenantId === p.tenantId &&
        scope.ownerProfileId === p.ownerProfileId)
      ? p
      : null;
  } catch {
    return null;
  }
}
export function assertDigestPolicyCurrent(policy: DigestPolicy): void {
  const current = readDigestPolicy();
  if (!current || pulseHash(current) !== pulseHash(policy))
    throw new Error('digest_policy_changed');
}
/** Verifies the actual frozen deployment inputs; no network or git command. */
export async function verifyDigestDependencies(policy: DigestPolicy, root?: string): Promise<void> {
  const contents = new Map<string, string>(
    root
      ? []
      : [
          ['package.json', frozenManifest],
          ['bun.lock', frozenLock],
        ],
  );
  for (const source of policy.sources)
    if (
      source.dependency.commit !== dependencySnapshot.commit ||
      source.dependency.fileHash !== dependencySnapshot.files['package.json'] ||
      source.dependency.lockHash !== dependencySnapshot.files['bun.lock']
    )
      throw new Error('digest_dependency_drift');
  for (const s of policy.sources)
    for (const [path, expected] of [
      [s.dependency.file, s.dependency.fileHash],
      [s.dependency.lockFile, s.dependency.lockHash],
    ]) {
      const full = resolve(root ?? process.cwd(), path);
      if (relative(root ?? process.cwd(), full).startsWith('..'))
        throw new Error('digest_anchor_outside_repository');
      let content = contents.get(path);
      if (content === undefined) {
        content = await readFile(full, 'utf8');
        contents.set(path, content);
      }
      if (createHash('sha256').update(content).digest('hex') !== expected)
        throw new Error('digest_dependency_drift');
    }
  const manifest: unknown = JSON.parse(contents.get('package.json')!);
  if (!manifest || typeof manifest !== 'object') throw new Error('digest_dependency_manifest');
  const m = manifest as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  for (const s of policy.sources)
    if (
      (m.dependencies?.[s.dependency.package] ?? m.devDependencies?.[s.dependency.package]) !==
      s.dependency.version
    )
      throw new Error('digest_dependency_relationship_unknown');
}
