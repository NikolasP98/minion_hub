import { relations } from 'drizzle-orm';
import {
  tenants,
  users,
  userTenants,
  servers,
  agents,
  skills,
  sessions,
  chatMessages,
  bugs,
  connectionEvents,
  settings,
  files,
  authSessions,
  missions,
  tasks,
  reliabilityEvents,
} from './schema';

// ── Tenants ──────────────────────────────────────────────────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  userTenants: many(userTenants),
  servers: many(servers),
  files: many(files),
}));

// ── Users ────────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  userTenants: many(userTenants),
  authSessions: many(authSessions),
  files: many(files),
}));

export const userTenantsRelations = relations(userTenants, ({ one }) => ({
  user: one(users, { fields: [userTenants.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [userTenants.tenantId], references: [tenants.id] }),
}));

// ── Servers ──────────────────────────────────────────────────────────────────

export const serversRelations = relations(servers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [servers.tenantId], references: [tenants.id] }),
  agents: many(agents),
  skills: many(skills),
  sessions: many(sessions),
  chatMessages: many(chatMessages),
  bugs: many(bugs),
  connectionEvents: many(connectionEvents),
  settings: many(settings),
}));

// ── Agents ───────────────────────────────────────────────────────────────────

export const agentsRelations = relations(agents, ({ one }) => ({
  server: one(servers, { fields: [agents.serverId], references: [servers.id] }),
  tenant: one(tenants, { fields: [agents.tenantId], references: [tenants.id] }),
}));

// ── Skills ───────────────────────────────────────────────────────────────────

export const skillsRelations = relations(skills, ({ one }) => ({
  server: one(servers, { fields: [skills.serverId], references: [servers.id] }),
  tenant: one(tenants, { fields: [skills.tenantId], references: [tenants.id] }),
}));

// ── Sessions ─────────────────────────────────────────────────────────────────

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  server: one(servers, { fields: [sessions.serverId], references: [servers.id] }),
  tenant: one(tenants, { fields: [sessions.tenantId], references: [tenants.id] }),
  missions: many(missions),
}));

// ── Chat Messages ────────────────────────────────────────────────────────────

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  server: one(servers, { fields: [chatMessages.serverId], references: [servers.id] }),
  tenant: one(tenants, { fields: [chatMessages.tenantId], references: [tenants.id] }),
}));

// ── Bugs ─────────────────────────────────────────────────────────────────────

export const bugsRelations = relations(bugs, ({ one }) => ({
  server: one(servers, { fields: [bugs.serverId], references: [servers.id] }),
  tenant: one(tenants, { fields: [bugs.tenantId], references: [tenants.id] }),
}));

// ── Connection Events ────────────────────────────────────────────────────────

export const connectionEventsRelations = relations(connectionEvents, ({ one }) => ({
  server: one(servers, { fields: [connectionEvents.serverId], references: [servers.id] }),
  tenant: one(tenants, { fields: [connectionEvents.tenantId], references: [tenants.id] }),
}));

// ── Settings ─────────────────────────────────────────────────────────────────

export const settingsRelations = relations(settings, ({ one }) => ({
  server: one(servers, { fields: [settings.serverId], references: [servers.id] }),
  tenant: one(tenants, { fields: [settings.tenantId], references: [tenants.id] }),
}));

// ── Files ────────────────────────────────────────────────────────────────────

export const filesRelations = relations(files, ({ one }) => ({
  tenant: one(tenants, { fields: [files.tenantId], references: [tenants.id] }),
  uploadedByUser: one(users, { fields: [files.uploadedBy], references: [users.id] }),
}));

// ── Auth Sessions ────────────────────────────────────────────────────────────

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, { fields: [authSessions.userId], references: [users.id] }),
}));

// ── Missions ──────────────────────────────────────────────────────────────────

export const missionsRelations = relations(missions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [missions.tenantId], references: [tenants.id] }),
  server: one(servers, { fields: [missions.serverId], references: [servers.id] }),
  session: one(sessions, { fields: [missions.sessionId], references: [sessions.id] }),
  tasks: many(tasks),
}));

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const tasksRelations = relations(tasks, ({ one }) => ({
  tenant: one(tenants, { fields: [tasks.tenantId], references: [tenants.id] }),
  mission: one(missions, { fields: [tasks.missionId], references: [missions.id] }),
}));

// ── Reliability Events ───────────────────────────────────────────────────────

export const reliabilityEventsRelations = relations(reliabilityEvents, ({ one }) => ({
  server: one(servers, { fields: [reliabilityEvents.serverId], references: [servers.id] }),
  tenant: one(tenants, { fields: [reliabilityEvents.tenantId], references: [tenants.id] }),
}));
