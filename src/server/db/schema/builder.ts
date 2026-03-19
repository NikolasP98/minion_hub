import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { servers } from './servers';
import { organization } from './auth';

// ── Built Skills ──────────────────────────────────────────────────────
export const builtSkills = sqliteTable('built_skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  emoji: text('emoji').default('📖'),
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
  maxCycles: integer('max_cycles').notNull().default(3),
  serverId: text('server_id').references(() => servers.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').references(() => organization.id, { onDelete: 'cascade' }),
  createdBy: text('created_by'),
  publishedAt: integer('published_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ── Skill Tool Pool (junction: skill → gateway tool IDs) ─────────────
export const builtSkillTools = sqliteTable('built_skill_tools', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => builtSkills.id, { onDelete: 'cascade' }),
  toolId: text('tool_id').notNull(), // gateway tool ID string (e.g., 'web-search')
});

// ── Chapters (subprocess nodes in the DAG) ───────────────────────────
export const builtChapters = sqliteTable('built_chapters', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => builtSkills.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['chapter', 'condition'] }).notNull().default('chapter'),
  name: text('name').notNull(),
  description: text('description').default(''),
  guide: text('guide').default(''),          // instructions/markdown
  context: text('context').default(''),       // constraints, additional context
  outputDef: text('output_def').default(''),  // what this chapter produces
  conditionText: text('condition_text').default(''),  // binary question for condition nodes
  positionX: real('position_x').notNull().default(0),
  positionY: real('position_y').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ── Chapter Edges (DAG connections between chapters) ─────────────────
export const builtChapterEdges = sqliteTable('built_chapter_edges', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => builtSkills.id, { onDelete: 'cascade' }),
  sourceChapterId: text('source_chapter_id').notNull().references(() => builtChapters.id, { onDelete: 'cascade' }),
  targetChapterId: text('target_chapter_id').notNull().references(() => builtChapters.id, { onDelete: 'cascade' }),
  label: text('label'),
});

// ── Chapter Tools (junction: chapter → subset of skill's tool pool) ──
export const builtChapterTools = sqliteTable('built_chapter_tools', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => builtChapters.id, { onDelete: 'cascade' }),
  toolId: text('tool_id').notNull(), // must exist in parent skill's pool
});

// ── Built Agents ─────────────────────────────────────────────────────
export const builtAgents = sqliteTable('built_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  emoji: text('emoji').default('🤖'),
  description: text('description').default(''),
  model: text('model'),
  systemPrompt: text('system_prompt').default(''),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(4096),
  retryPolicy: text('retry_policy').default('{}'), // JSON
  fallbackAgentId: text('fallback_agent_id'),
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
  serverId: text('server_id').references(() => servers.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').references(() => organization.id, { onDelete: 'cascade' }),
  createdBy: text('created_by'),
  publishedAt: integer('published_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ── Agent Skill Slots (junction: agent → skill with order) ───────────
export const builtAgentSkills = sqliteTable('built_agent_skills', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => builtAgents.id, { onDelete: 'cascade' }),
  skillId: text('skill_id').notNull().references(() => builtSkills.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  configOverrides: text('config_overrides').default('{}'), // JSON
});

// ── Agent Built Skills (junction: gateway agent → built skill) ────────
export const agentBuiltSkills = sqliteTable('agent_built_skills', {
  id: text('id').primaryKey(),
  gatewayAgentId: text('gateway_agent_id').notNull(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  skillId: text('skill_id').notNull().references(() => builtSkills.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

// ── Built Tools (admin-only playground) ──────────────────────────────
export const builtTools = sqliteTable('built_tools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  scriptCode: text('script_code').default(''),
  scriptLang: text('script_lang', { enum: ['javascript', 'python', 'bash'] }).notNull().default('javascript'),
  envVars: text('env_vars').default('{}'),           // JSON key-value
  validationRules: text('validation_rules').default('{}'), // JSON input schema
  executionConfig: text('execution_config').default('{}'), // JSON timeout, retries
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
  serverId: text('server_id').references(() => servers.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').references(() => organization.id, { onDelete: 'cascade' }),
  createdBy: text('created_by'),
  publishedAt: integer('published_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
