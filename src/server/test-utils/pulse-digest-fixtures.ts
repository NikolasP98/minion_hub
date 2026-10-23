import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseDigestPolicy } from '../services/pulse-digest.policy';
import { collectDigestSources, type DigestSnapshot } from '../services/pulse-digest.sources';
import { PULSE_FIXTURE_ORG, PULSE_FIXTURE_PROFILE } from './pulse-fixtures';
const example = JSON.parse(
  readFileSync(new URL('../pulse/digest-policy.example.json', import.meta.url), 'utf8'),
);
export function digestFixturePolicy(namespace = 'fixture-v1') {
  const policy = structuredClone(example);
  policy.enabled = true;
  policy.tenantId = PULSE_FIXTURE_ORG;
  policy.ownerProfileId = PULSE_FIXTURE_PROFILE;
  policy.revision = namespace;
  policy.budgetNamespace = namespace;
  policy.model = 'fixture/model';
  policy.maxCallsPerDay = 5;
  policy.approval = {
    ...policy.approval,
    reference: 'local-only-approved-fixture',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    upperMicroUsd: 1000,
    dailyMicroUsd: 5000,
  };
  policy.sources[0].dependency.fileHash = createHash('sha256')
    .update(readFileSync('package.json'))
    .digest('hex');
  return parseDigestPolicy(policy);
}
export async function digestFixtureSnapshot(
  policy = digestFixturePolicy(),
  version = 'fixture-v1',
): Promise<DigestSnapshot> {
  return collectDigestSources(
    policy,
    [],
    { signal: new AbortController().signal, deadline: performance.now() + 15000 },
    async () => ({
      status: 200,
      etag: 'fixture',
      lastModified: null,
      body: JSON.stringify([
        {
          html_url: `https://github.com/vercel/ai/releases/tag/${version}`,
          tag_name: `ai@${version}`,
          name: 'Fixture release',
          body: 'A supported synthetic dependency change.',
        },
      ]),
    }),
  );
}
export function digestFixtureResponse(
  snapshot: DigestSnapshot,
  options: { cost?: number | null; invalid?: boolean; model?: string } = {},
) {
  const e = snapshot.evidence[0];
  const result = {
    disposition: 'actionable',
    title: 'Review the SDK dependency',
    summary: 'The official release changes the installed SDK.',
    citations: [
      {
        sourceId: e.sourceId,
        contentHash: e.contentHash,
        package: e.dependency.package,
        file: e.dependency.file,
      },
    ],
    claim: 'Synthetic supported fixture claim.',
    relevance: 'The SDK is present in this repository.',
    nextStep: 'Review the linked release before upgrading.',
  };
  return {
    id: 'fixture-response',
    object: 'chat.completion',
    created: 1,
    model: options.model ?? 'fixture/model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: options.invalid ? 'invalid-json' : JSON.stringify(result),
        },
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
      ...(options.cost === null ? {} : { cost: options.cost ?? 0.0001 }),
    },
  };
}
