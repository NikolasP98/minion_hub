/**
 * Client-side known-fields registry for agent settings.
 * Defines all OpenClaw agent settings with groups, schemas, and structure detection.
 */
import type { JsonSchemaNode, ConfigUiHint } from '$lib/types/config';
import { deepGet } from '$lib/utils/config-schema';

// ─── Structure Detection ─────────────────────────────────────────────────────

export type AgentStructure =
  | { type: 'flat'; pathPrefix: string }
  | { type: 'list'; pathPrefix: string; listIndex: number }
  | { type: 'not-found' };

/**
 * Detects whether the config uses flat agent-ID keys or defaults+list[] structure.
 * Returns the correct pathPrefix for setField() calls.
 */
export function detectAgentStructure(
  config: Record<string, unknown>,
  agentId: string,
): AgentStructure {
  const agents = config.agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    return { type: 'not-found' };
  }

  const agentsObj = agents as Record<string, unknown>;

  // Check for list structure: agents.list is an array
  if (Array.isArray(agentsObj.list)) {
    const list = agentsObj.list as Record<string, unknown>[];
    const idx = list.findIndex((item) => item?.id === agentId);
    if (idx >= 0) {
      return { type: 'list', pathPrefix: `agents.list.${idx}`, listIndex: idx };
    }
    // Agent not yet in list — will be added at the end
    return { type: 'list', pathPrefix: `agents.list.${list.length}`, listIndex: list.length };
  }

  // Check for flat structure: agents[agentId] exists or agents has known agent-like keys
  if (agentsObj[agentId] !== undefined) {
    return { type: 'flat', pathPrefix: `agents.${agentId}` };
  }

  // Check if any key looks like an agent entry (has object value with typical agent fields)
  // If agents has 'defaults' but no 'list', it might be partially configured
  if (agentsObj.defaults !== undefined) {
    // Defaults exist but no list yet — treat as list structure, will create list on first write
    return { type: 'list', pathPrefix: `agents.list.0`, listIndex: 0 };
  }

  // Fallback: assume flat structure (new agent)
  return { type: 'flat', pathPrefix: `agents.${agentId}` };
}

/**
 * Returns agents.defaults if it exists (for defaults+list structure).
 */
export function getAgentDefaults(config: Record<string, unknown>): Record<string, unknown> | null {
  const defaults = deepGet(config, 'agents.defaults');
  if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
    return defaults as Record<string, unknown>;
  }
  return null;
}

/**
 * Returns the actual agent config data regardless of structure.
 */
export function getAgentData(
  config: Record<string, unknown>,
  structure: AgentStructure,
): Record<string, unknown> | null {
  if (structure.type === 'not-found') return null;
  const data = deepGet(config, structure.pathPrefix);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return null;
}

/**
 * Tries to extract a per-agent schema from the gateway schema.
 */
export function extractGatewayAgentSchema(
  schema: JsonSchemaNode | null,
): JsonSchemaNode | null {
  if (!schema?.properties?.agents) return null;
  const agentsSchema = schema.properties.agents;

  // Try: agents.properties.list.items (defaults+list structure)
  const listSchema = agentsSchema.properties?.list;
  if (listSchema?.items) {
    const items = Array.isArray(listSchema.items) ? listSchema.items[0] : listSchema.items;
    if (items?.properties) return items;
  }

  // Try: agents.additionalProperties (if it's an object schema, not just `true`)
  if (
    agentsSchema.additionalProperties &&
    typeof agentsSchema.additionalProperties === 'object' &&
    agentsSchema.additionalProperties.properties
  ) {
    return agentsSchema.additionalProperties;
  }

  // Try: agents.properties.defaults (use its shape as a template)
  if (agentsSchema.properties?.defaults?.properties) {
    return agentsSchema.properties.defaults;
  }

  return null;
}

/**
 * Resolves the schema for a specific field: tries gateway schema first, falls back to static.
 */
export function resolveFieldSchema(
  setting: AgentSettingDef,
  gatewaySchema: JsonSchemaNode | null,
): JsonSchemaNode {
  if (gatewaySchema) {
    // Walk the gateway schema by the setting's dot-path key
    const parts = setting.key.split('.');
    let node: JsonSchemaNode | undefined = gatewaySchema;
    for (const part of parts) {
      if (!node?.properties?.[part]) {
        node = undefined;
        break;
      }
      node = node.properties[part];
    }
    if (node) return node;
  }
  return setting.schema;
}

// ─── Group Definitions ───────────────────────────────────────────────────────

export type AgentGroup = {
  id: string;
  label: string;
  description: string;
  order: number;
};

export const AGENT_GROUPS: AgentGroup[] = [
  { id: 'identity', label: 'Identity', description: 'Name, emoji, theme, and default agent flag', order: 10 },
  { id: 'model', label: 'Model', description: 'Primary model, fallbacks, and model aliases', order: 20 },
  { id: 'workspace', label: 'Workspace', description: 'Working directory and bootstrap settings', order: 30 },
  { id: 'memory', label: 'Memory Search', description: 'Memory provider, model, and sources', order: 40 },
  { id: 'context', label: 'Context Pruning', description: 'Pruning mode, TTL, and token limits', order: 50 },
  { id: 'compaction', label: 'Compaction', description: 'Compaction mode and memory flush', order: 55 },
  { id: 'behavior', label: 'Behavior', description: 'Heartbeat, concurrency, and human delay', order: 60 },
  { id: 'tools', label: 'Tools', description: 'Tool profile, allow/deny lists, and exec', order: 70 },
  { id: 'sandbox', label: 'Sandbox', description: 'Sandbox mode, scope, and workspace access', order: 80 },
  { id: 'session', label: 'Session', description: 'DM scope, reset policy, and queue mode', order: 90 },
  { id: 'advanced', label: 'Advanced', description: 'Temperature, max tokens, and cache TTL', order: 100 },
];

export const AGENT_GROUPS_MAP = new Map(AGENT_GROUPS.map((g) => [g.id, g]));

// ─── Field Definitions ───────────────────────────────────────────────────────

export type AgentSettingDef = {
  key: string;       // dot-path relative to agent root (e.g. 'identity.name')
  group: string;     // group ID
  order: number;     // sort order within group
  schema: JsonSchemaNode;  // fallback schema if gateway doesn't provide one
  hint: ConfigUiHint;      // UI hint (label, help text, etc.)
};

export const AGENT_SETTINGS: AgentSettingDef[] = [
  // ── Identity ───────────────────────────────────────────────────
  {
    key: 'id', group: 'identity', order: 0,
    schema: { type: 'string', title: 'ID', description: 'Unique agent identifier' },
    hint: { label: 'Agent ID', help: 'Unique identifier for this agent. Usually matches the config key.' },
  },
  {
    key: 'default', group: 'identity', order: 1,
    schema: { type: 'boolean', title: 'Default Agent', description: 'Whether this is the default agent' },
    hint: { label: 'Default Agent', help: 'If true, this agent handles messages when no specific agent is targeted.' },
  },
  {
    key: 'identity.name', group: 'identity', order: 2,
    schema: { type: 'string', title: 'Name' },
    hint: { label: 'Display Name', help: 'The name shown in conversations and UI.' },
  },
  {
    key: 'identity.emoji', group: 'identity', order: 3,
    schema: { type: 'string', title: 'Emoji' },
    hint: { label: 'Emoji', help: 'Emoji displayed next to the agent name.' },
  },
  {
    key: 'identity.theme', group: 'identity', order: 4,
    schema: { type: 'string', title: 'Theme' },
    hint: { label: 'Theme', help: 'Visual theme identifier for this agent.' },
  },

  // ── Model ──────────────────────────────────────────────────────
  {
    key: 'model.primary', group: 'model', order: 0,
    schema: { type: 'string', title: 'Primary Model' },
    hint: { label: 'Primary Model', help: 'The main LLM model used for this agent (e.g. gpt-4o, claude-3-opus).' },
  },
  {
    key: 'model.fallbacks', group: 'model', order: 1,
    schema: { type: 'array', title: 'Fallback Models', items: { type: 'string' } },
    hint: { label: 'Fallback Models', help: 'Models to try if the primary is unavailable.' },
  },
  {
    key: 'models', group: 'model', order: 2,
    schema: { type: 'object', title: 'Model Aliases', additionalProperties: true },
    hint: { label: 'Model Aliases', help: 'Named model aliases with per-model parameters (e.g. { "fast": "gpt-4o-mini" }).' },
  },

  // ── Workspace ──────────────────────────────────────────────────
  {
    key: 'workspace', group: 'workspace', order: 0,
    schema: { type: 'string', title: 'Workspace' },
    hint: { label: 'Working Directory', help: 'Path to the agent working directory.' },
  },
  {
    key: 'skipBootstrap', group: 'workspace', order: 1,
    schema: { type: 'boolean', title: 'Skip Bootstrap' },
    hint: { label: 'Skip Bootstrap', help: 'If true, skip workspace bootstrap on startup.' },
  },

  // ── Memory Search ──────────────────────────────────────────────
  {
    key: 'memorySearch.enabled', group: 'memory', order: 0,
    schema: { type: 'boolean', title: 'Enabled' },
    hint: { label: 'Enabled', help: 'Enable memory search for this agent.' },
  },
  {
    key: 'memorySearch.provider', group: 'memory', order: 1,
    schema: { type: 'string', title: 'Provider' },
    hint: { label: 'Provider', help: 'Memory search provider (e.g. chroma, pinecone).' },
  },
  {
    key: 'memorySearch.model', group: 'memory', order: 2,
    schema: { type: 'string', title: 'Model' },
    hint: { label: 'Embedding Model', help: 'Model used for memory embeddings.' },
  },
  {
    key: 'memorySearch.sources', group: 'memory', order: 3,
    schema: { type: 'array', title: 'Sources', items: { type: 'string' } },
    hint: { label: 'Sources', help: 'Memory sources to search (e.g. ["conversation", "knowledge"]).' },
  },
  {
    key: 'memorySearch.experimental', group: 'memory', order: 4,
    schema: { type: 'object', title: 'Experimental', additionalProperties: true },
    hint: { label: 'Experimental', help: 'Experimental memory search options.' },
  },

  // ── Context Pruning ────────────────────────────────────────────
  {
    key: 'contextPruning.mode', group: 'context', order: 0,
    schema: { type: 'string', title: 'Mode', enum: ['cache-ttl', 'token-limit', 'none'] },
    hint: { label: 'Pruning Mode', help: 'How context messages are pruned: by cache TTL, token limit, or not at all.' },
  },
  {
    key: 'contextPruning.ttl', group: 'context', order: 1,
    schema: { type: 'number', title: 'TTL (seconds)' },
    hint: { label: 'TTL', help: 'Time-to-live in seconds for cached context messages.' },
  },
  {
    key: 'contextPruning.maxTokens', group: 'context', order: 2,
    schema: { type: 'number', title: 'Max Tokens' },
    hint: { label: 'Max Tokens', help: 'Maximum token count for context window.' },
  },
  {
    key: 'contextPruning.keepLastAssistants', group: 'context', order: 3,
    schema: { type: 'number', title: 'Keep Last Assistants' },
    hint: { label: 'Keep Last Assistants', help: 'Number of recent assistant messages to always keep.' },
  },

  // ── Compaction ─────────────────────────────────────────────────
  {
    key: 'compaction.mode', group: 'compaction', order: 0,
    schema: { type: 'string', title: 'Mode' },
    hint: { label: 'Compaction Mode', help: 'How conversation history is compacted.' },
  },
  {
    key: 'compaction.memoryFlush', group: 'compaction', order: 1,
    schema: { type: 'object', title: 'Memory Flush', additionalProperties: true },
    hint: { label: 'Memory Flush', help: 'Settings for flushing compacted memories.' },
  },

  // ── Behavior ───────────────────────────────────────────────────
  {
    key: 'heartbeat.every', group: 'behavior', order: 0,
    schema: { type: 'number', title: 'Heartbeat Interval' },
    hint: { label: 'Heartbeat Interval', help: 'Seconds between heartbeat checks.' },
  },
  {
    key: 'heartbeat.model', group: 'behavior', order: 1,
    schema: { type: 'string', title: 'Heartbeat Model' },
    hint: { label: 'Heartbeat Model', help: 'Model used for heartbeat evaluations.' },
  },
  {
    key: 'heartbeat.schedule', group: 'behavior', order: 2,
    schema: { type: 'object', title: 'Heartbeat Schedule', additionalProperties: true },
    hint: { label: 'Heartbeat Schedule', help: 'Cron-like schedule for heartbeat.' },
  },
  {
    key: 'maxConcurrent', group: 'behavior', order: 3,
    schema: { type: 'number', title: 'Max Concurrent', minimum: 1 },
    hint: { label: 'Max Concurrent', help: 'Maximum concurrent tasks for this agent.' },
  },
  {
    key: 'subagents.maxConcurrent', group: 'behavior', order: 4,
    schema: { type: 'number', title: 'Max Concurrent Subagents', minimum: 1 },
    hint: { label: 'Max Concurrent Subagents', help: 'Maximum concurrent subagent tasks.' },
  },
  {
    key: 'humanDelay.mode', group: 'behavior', order: 5,
    schema: { type: 'string', title: 'Human Delay Mode' },
    hint: { label: 'Human Delay', help: 'Simulated typing delay mode (e.g. off, natural, fixed).' },
  },

  // ── Tools ──────────────────────────────────────────────────────
  {
    key: 'tools.profile', group: 'tools', order: 0,
    schema: { type: 'string', title: 'Tool Profile', enum: ['minimal', 'coding', 'messaging', 'full'] },
    hint: { label: 'Tool Profile', help: 'Preset tool profile: minimal, coding, messaging, or full.' },
  },
  {
    key: 'tools.allow', group: 'tools', order: 1,
    schema: { type: 'array', title: 'Allow List', items: { type: 'string' } },
    hint: { label: 'Allow List', help: 'Explicit list of allowed tool names.' },
  },
  {
    key: 'tools.deny', group: 'tools', order: 2,
    schema: { type: 'array', title: 'Deny List', items: { type: 'string' } },
    hint: { label: 'Deny List', help: 'Explicit list of denied tool names.' },
  },
  {
    key: 'tools.byProvider', group: 'tools', order: 3,
    schema: { type: 'object', title: 'By Provider', additionalProperties: true },
    hint: { label: 'By Provider', help: 'Per-provider tool overrides.' },
  },
  {
    key: 'tools.elevated', group: 'tools', order: 4,
    schema: { type: 'array', title: 'Elevated Tools', items: { type: 'string' } },
    hint: { label: 'Elevated Tools', help: 'Tools that require elevated permissions.' },
  },
  {
    key: 'tools.exec', group: 'tools', order: 5,
    schema: { type: 'object', title: 'Exec Config', additionalProperties: true },
    hint: { label: 'Exec Config', help: 'Configuration for the exec/shell tool.' },
  },

  // ── Sandbox ────────────────────────────────────────────────────
  {
    key: 'sandbox.mode', group: 'sandbox', order: 0,
    schema: { type: 'string', title: 'Sandbox Mode', enum: ['off', 'non-main', 'all'] },
    hint: { label: 'Sandbox Mode', help: 'When to sandbox tool execution: off, non-main sessions only, or all.' },
  },
  {
    key: 'sandbox.scope', group: 'sandbox', order: 1,
    schema: { type: 'string', title: 'Scope' },
    hint: { label: 'Scope', help: 'Sandbox scope configuration.' },
  },
  {
    key: 'sandbox.workspaceAccess', group: 'sandbox', order: 2,
    schema: { type: 'string', title: 'Workspace Access' },
    hint: { label: 'Workspace Access', help: 'How the sandbox accesses the workspace directory.' },
  },
  {
    key: 'sandbox.docker', group: 'sandbox', order: 3,
    schema: { type: 'object', title: 'Docker Config', additionalProperties: true },
    hint: { label: 'Docker Config', help: 'Docker-specific sandbox settings.' },
  },
  {
    key: 'sandbox.browser', group: 'sandbox', order: 4,
    schema: { type: 'object', title: 'Browser Config', additionalProperties: true },
    hint: { label: 'Browser Config', help: 'Browser sandbox settings.' },
  },
  {
    key: 'sandbox.tools', group: 'sandbox', order: 5,
    schema: { type: 'object', title: 'Sandbox Tool Overrides', additionalProperties: true },
    hint: { label: 'Tool Overrides', help: 'Per-tool sandbox overrides.' },
  },

  // ── Session ────────────────────────────────────────────────────
  {
    key: 'session.dmScope', group: 'session', order: 0,
    schema: { type: 'string', title: 'DM Scope' },
    hint: { label: 'DM Scope', help: 'Direct message session scope.' },
  },
  {
    key: 'session.reset', group: 'session', order: 1,
    schema: { type: 'string', title: 'Reset Policy' },
    hint: { label: 'Reset Policy', help: 'When sessions are automatically reset.' },
  },
  {
    key: 'session.resetByChannel', group: 'session', order: 2,
    schema: { type: 'object', title: 'Reset by Channel', additionalProperties: true },
    hint: { label: 'Reset by Channel', help: 'Per-channel reset policy overrides.' },
  },
  {
    key: 'session.queue.mode', group: 'session', order: 3,
    schema: { type: 'string', title: 'Queue Mode' },
    hint: { label: 'Queue Mode', help: 'How incoming messages are queued (e.g. fifo, latest).' },
  },
  {
    key: 'session.sendPolicy', group: 'session', order: 4,
    schema: { type: 'string', title: 'Send Policy' },
    hint: { label: 'Send Policy', help: 'Message sending policy (e.g. immediate, batched).' },
  },

  // ── Advanced ───────────────────────────────────────────────────
  {
    key: 'temperature', group: 'advanced', order: 0,
    schema: { type: 'number', title: 'Temperature', minimum: 0, maximum: 2 },
    hint: { label: 'Temperature', help: 'LLM sampling temperature (0 = deterministic, higher = more creative).' },
  },
  {
    key: 'maxTokens', group: 'advanced', order: 1,
    schema: { type: 'number', title: 'Max Tokens', minimum: 1 },
    hint: { label: 'Max Output Tokens', help: 'Maximum tokens in the LLM response.' },
  },
  {
    key: 'cacheControlTtl', group: 'advanced', order: 2,
    schema: { type: 'number', title: 'Cache Control TTL' },
    hint: { label: 'Cache Control TTL', help: 'Cache-control TTL in seconds for prompt caching.' },
  },
];

// Build a lookup by key for fast access
const SETTINGS_BY_KEY = new Map(AGENT_SETTINGS.map((s) => [s.key, s]));

// ─── Extra Field Detection ───────────────────────────────────────────────────

/**
 * Finds keys in the agent's actual config data that aren't covered by known settings.
 * Returns them as ad-hoc AgentSettingDef entries in an "Other" group.
 */
export function detectExtraFields(
  agentData: Record<string, unknown> | null,
): AgentSettingDef[] {
  if (!agentData) return [];

  const knownTopKeys = new Set<string>();
  for (const s of AGENT_SETTINGS) {
    knownTopKeys.add(s.key.split('.')[0]);
  }

  const extras: AgentSettingDef[] = [];
  for (const [key, val] of Object.entries(agentData)) {
    if (knownTopKeys.has(key)) continue;
    if (key === 'id') continue; // already in identity group

    extras.push({
      key,
      group: 'other',
      order: extras.length,
      schema: inferTypeSchema(val),
      hint: { label: key },
    });
  }
  return extras;
}

function inferTypeSchema(val: unknown): JsonSchemaNode {
  if (val === null || val === undefined) return { type: 'string' };
  if (typeof val === 'boolean') return { type: 'boolean' };
  if (typeof val === 'number') return { type: 'number' };
  if (typeof val === 'string') return { type: 'string' };
  if (Array.isArray(val)) return { type: 'array', items: { type: 'string' } };
  if (typeof val === 'object') return { type: 'object', additionalProperties: true };
  return { type: 'string' };
}

// ─── Grouped Field Resolution ────────────────────────────────────────────────

export type ResolvedField = {
  key: string;
  path: string;                // full config path for setField()
  schema: JsonSchemaNode;
  hint: ConfigUiHint;
  value: unknown;
  defaultValue: unknown;
  isOverridden: boolean;       // value !== undefined (has explicit value, not just default)
};

export type ResolvedGroup = {
  group: AgentGroup;
  fields: ResolvedField[];
  hasValues: boolean;          // any field has a value or default
};

/**
 * Builds grouped, resolved fields for an agent.
 */
export function buildGroupedFields(
  config: Record<string, unknown>,
  schema: JsonSchemaNode | null,
  agentId: string,
): { groups: ResolvedGroup[]; structure: AgentStructure } {
  const structure = detectAgentStructure(config, agentId);
  const agentData = getAgentData(config, structure);
  const defaults = getAgentDefaults(config);
  const gatewaySchema = extractGatewayAgentSchema(schema);

  // Build resolved fields for each known setting
  const groupedFields = new Map<string, ResolvedField[]>();

  for (const setting of AGENT_SETTINGS) {
    const resolvedSchema = resolveFieldSchema(setting, gatewaySchema);
    const path = structure.type !== 'not-found'
      ? `${structure.pathPrefix}.${setting.key}`
      : `agents.${agentId}.${setting.key}`;

    const value = agentData ? deepGet(agentData, setting.key) : undefined;
    const defaultValue = defaults ? deepGet(defaults, setting.key) : undefined;

    const field: ResolvedField = {
      key: setting.key,
      path,
      schema: resolvedSchema,
      hint: { ...setting.hint },
      value,
      defaultValue,
      isOverridden: value !== undefined,
    };

    // Add default value as placeholder text
    if (defaultValue !== undefined && !field.hint.placeholder) {
      field.hint.placeholder = `Default: ${JSON.stringify(defaultValue)}`;
    }

    const groupId = setting.group;
    if (!groupedFields.has(groupId)) groupedFields.set(groupId, []);
    groupedFields.get(groupId)!.push(field);
  }

  // Detect extra fields not in our registry
  const extras = detectExtraFields(agentData);
  if (extras.length > 0) {
    const otherFields: ResolvedField[] = [];
    for (const setting of extras) {
      const path = structure.type !== 'not-found'
        ? `${structure.pathPrefix}.${setting.key}`
        : `agents.${agentId}.${setting.key}`;

      otherFields.push({
        key: setting.key,
        path,
        schema: setting.schema,
        hint: setting.hint,
        value: agentData ? deepGet(agentData, setting.key) : undefined,
        defaultValue: defaults ? deepGet(defaults, setting.key) : undefined,
        isOverridden: agentData ? deepGet(agentData, setting.key) !== undefined : false,
      });
    }
    groupedFields.set('other', otherFields);
  }

  // Build sorted groups, filtering visibility
  const allGroups = [
    ...AGENT_GROUPS,
    ...(extras.length > 0
      ? [{ id: 'other', label: 'Other', description: 'Additional fields not in standard groups', order: 999 }]
      : []),
  ];

  const result: ResolvedGroup[] = [];
  for (const group of allGroups) {
    const fields = groupedFields.get(group.id);
    if (!fields) continue;

    // Sort fields by order
    fields.sort((a, b) => {
      const aDef = SETTINGS_BY_KEY.get(a.key);
      const bDef = SETTINGS_BY_KEY.get(b.key);
      return (aDef?.order ?? 999) - (bDef?.order ?? 999);
    });

    const hasValues = fields.some((f) => f.value !== undefined || f.defaultValue !== undefined);

    result.push({ group, fields, hasValues });
  }

  return { groups: result, structure };
}
