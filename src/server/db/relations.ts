import { relations } from 'drizzle-orm';
import {
  user,
  session,
  account,
  member,
  organization,
  invitation,
  servers,
  agents,
  skills,
  sessions,
  chatMessages,
  bugs,
  connectionEvents,
  settings,
  files,
  missions,
  tasks,
  reliabilityEvents,
  sessionTasks,
} from './schema';

// ── Better Auth: User ─────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(member),
  invitations: many(invitation),
  files: many(files),
}));

// ── Better Auth: Session ──────────────────────────────────────────────────────

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

// ── Better Auth: Account ──────────────────────────────────────────────────────

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ── Better Auth: Organization ─────────────────────────────────────────────────

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  servers: many(servers),
  files: many(files),
}));

// ── Better Auth: Member ───────────────────────────────────────────────────────

export const memberRelations = relations(member, ({ one }) => ({
  user: one(user, { fields: [member.userId], references: [user.id] }),
  organization: one(organization, { fields: [member.organizationId], references: [organization.id] }),
}));

// ── Better Auth: Invitation ───────────────────────────────────────────────────

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, { fields: [invitation.organizationId], references: [organization.id] }),
  inviter: one(user, { fields: [invitation.inviterId], references: [user.id] }),
}));

// ── Servers ──────────────────────────────────────────────────────────────────

export const serversRelations = relations(servers, ({ one, many }) => ({
  organization: one(organization, { fields: [servers.tenantId], references: [organization.id] }),
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
  organization: one(organization, { fields: [agents.tenantId], references: [organization.id] }),
}));

// ── Skills ───────────────────────────────────────────────────────────────────

export const skillsRelations = relations(skills, ({ one }) => ({
  server: one(servers, { fields: [skills.serverId], references: [servers.id] }),
  organization: one(organization, { fields: [skills.tenantId], references: [organization.id] }),
}));

// ── Sessions (gateway sessions, not auth sessions) ────────────────────────────

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  server: one(servers, { fields: [sessions.serverId], references: [servers.id] }),
  organization: one(organization, { fields: [sessions.tenantId], references: [organization.id] }),
  missions: many(missions),
}));

// ── Chat Messages ────────────────────────────────────────────────────────────

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  server: one(servers, { fields: [chatMessages.serverId], references: [servers.id] }),
  organization: one(organization, { fields: [chatMessages.tenantId], references: [organization.id] }),
}));

// ── Bugs ─────────────────────────────────────────────────────────────────────

export const bugsRelations = relations(bugs, ({ one }) => ({
  server: one(servers, { fields: [bugs.serverId], references: [servers.id] }),
  organization: one(organization, { fields: [bugs.tenantId], references: [organization.id] }),
}));

// ── Connection Events ────────────────────────────────────────────────────────

export const connectionEventsRelations = relations(connectionEvents, ({ one }) => ({
  server: one(servers, { fields: [connectionEvents.serverId], references: [servers.id] }),
  organization: one(organization, { fields: [connectionEvents.tenantId], references: [organization.id] }),
}));

// ── Settings ─────────────────────────────────────────────────────────────────

export const settingsRelations = relations(settings, ({ one }) => ({
  server: one(servers, { fields: [settings.serverId], references: [servers.id] }),
  organization: one(organization, { fields: [settings.tenantId], references: [organization.id] }),
}));

// ── Files ────────────────────────────────────────────────────────────────────

export const filesRelations = relations(files, ({ one }) => ({
  organization: one(organization, { fields: [files.tenantId], references: [organization.id] }),
  uploadedByUser: one(user, { fields: [files.uploadedBy], references: [user.id] }),
}));

// ── Missions ──────────────────────────────────────────────────────────────────

export const missionsRelations = relations(missions, ({ one, many }) => ({
  organization: one(organization, { fields: [missions.tenantId], references: [organization.id] }),
  server: one(servers, { fields: [missions.serverId], references: [servers.id] }),
  session: one(sessions, { fields: [missions.sessionId], references: [sessions.id] }),
  tasks: many(tasks),
}));

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const tasksRelations = relations(tasks, ({ one }) => ({
  organization: one(organization, { fields: [tasks.tenantId], references: [organization.id] }),
  mission: one(missions, { fields: [tasks.missionId], references: [missions.id] }),
}));

// ── Reliability Events ───────────────────────────────────────────────────────

export const reliabilityEventsRelations = relations(reliabilityEvents, ({ one }) => ({
  server: one(servers, { fields: [reliabilityEvents.serverId], references: [servers.id] }),
  organization: one(organization, { fields: [reliabilityEvents.tenantId], references: [organization.id] }),
}));

// ── Session Tasks ────────────────────────────────────────────────────────

export const sessionTasksRelations = relations(sessionTasks, ({ one }) => ({
  organization: one(organization, { fields: [sessionTasks.tenantId], references: [organization.id] }),
  server: one(servers, { fields: [sessionTasks.serverId], references: [servers.id] }),
}));
