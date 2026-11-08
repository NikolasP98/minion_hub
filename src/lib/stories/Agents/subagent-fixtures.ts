// Dummy subagent sessions shared by the Subagent* stories (not a story file).
import type { SubagentSession } from '$lib/state/features/subagent-data.svelte';
import type { OrchestrationEntry, SubagentEntry } from '$lib/state/features/pi-agent-state.svelte';

export const AGENT_ID = 'panik';
const now = Date.now();
export const key = (slug: string) => `agent:${AGENT_ID}:subagent:${slug}`;

export const running: SubagentSession = {
  key: key('scan-competitors'),
  label: 'researcher: Scan competitor pricing pages',
  model: 'claude-sonnet-4-5',
  modelProvider: 'anthropic',
  spawnDepth: 1,
  updatedAt: now - 20_000,
  inputTokens: 18_420,
  outputTokens: 2_310,
  channel: 'web',
};
export const completed: SubagentSession = {
  key: key('summarise-week'),
  label: 'writer: Summarise the week for the clinic owner',
  model: 'claude-haiku-4-5',
  spawnDepth: 1,
  updatedAt: now - 2 * 3_600_000,
  totalTokens: 7_900,
};
export const failed: SubagentSession = {
  key: key('deploy-check'),
  label: 'ops: Verify the deploy',
  model: 'claude-sonnet-4-5',
  spawnDepth: 1,
  updatedAt: now - 26 * 3_600_000,
  abortedLastRun: true,
  totalTokens: 1_204_883,
};
export const unknown: SubagentSession = { key: key('orphan'), updatedAt: null };

/** root → child-a → grandchild → great-grandchild (3 levels of nesting). */
export const nested: SubagentSession[] = [
  { ...running, key: key('root'), label: 'planner: Plan the spring launch', spawnDepth: 0 },
  { ...running, key: key('child-a'), label: 'researcher: Market sizing', spawnDepth: 1, spawnedBy: key('root'), updatedAt: now - 40_000 },
  { ...completed, key: key('child-b'), label: 'writer: Draft the brief', spawnDepth: 1, spawnedBy: key('root') },
  { ...running, key: key('grandchild'), label: 'researcher: Pull SUNAT tariff tables', spawnDepth: 2, spawnedBy: key('child-a'), updatedAt: now - 5_000 },
  { ...failed, key: key('great-grandchild'), label: 'ops: Fetch the PDF', spawnDepth: 3, spawnedBy: key('grandchild') },
];

export const many: SubagentSession[] = Array.from({ length: 20 }, (_, i) => ({
  key: key(`batch-${i + 1}`),
  label: `${['researcher', 'writer', 'ops', 'reviewer'][i % 4]}: Task ${i + 1} of the nightly batch`,
  model: i % 3 ? 'claude-sonnet-4-5' : 'claude-haiku-4-5',
  spawnDepth: 1,
  updatedAt: now - i * 47 * 60_000,
  abortedLastRun: i % 7 === 6,
  totalTokens: 1_500 * (i + 1),
}));

/** pi-agent registry rows for `nested` (status + tokens + one orchestration group). */
export const piEntries: SubagentEntry[] = nested.map((s, i) => ({
  key: s.key,
  label: s.label ?? null,
  template: s.label?.split(':')[0] ?? null,
  model: s.model ?? null,
  orchestrationId: i < 3 ? 'orch-launch' : null,
  spawnDepth: s.spawnDepth ?? 0,
  status: s.abortedLastRun ? 'failed' : (s.updatedAt ?? 0) > now - 300_000 ? 'running' : 'completed',
  inputTokens: 12_000 * (i + 1),
  outputTokens: 900 * (i + 1),
  spawnedBy: s.spawnedBy ?? null,
  startedAt: now - 120_000,
  completedAt: null,
  resultText: null,
}));
export const orchestration: OrchestrationEntry = {
  orchestrationId: 'orch-launch',
  mode: 'parallel',
  status: 'running',
  taskCount: 3,
  startedAt: now - 120_000,
};
