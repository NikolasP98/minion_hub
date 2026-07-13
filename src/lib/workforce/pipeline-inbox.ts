export type InboxNotificationType =
  'comment' | 'approval' | 'run_failed' | 'join_request' | 'mention' | 'goal_achieved' | 'paused';

export type InboxEntityType = 'issue' | 'approval' | 'agent' | 'goal' | 'user' | null;

export type InboxNotificationItem = {
  id: string;
  type: InboxNotificationType;
  title: string;
  body: string | null;
  actorAgentId: string | null;
  actorUserId: string | null;
  entityType: InboxEntityType;
  entityId: string | null;
  href: string | null;
  createdAt: string;
  readAt: string | null;
};

export type PipelineHitlInboxItem = {
  id: string;
  type: 'pipeline_hitl';
  title: string;
  body: string | null;
  actorAgentId: null;
  actorUserId: null;
  entityType: 'issue';
  entityId: string;
  href: string;
  createdAt: string;
  readAt: string | null;
  pipelineRunId: string;
  rootIssueId: string;
  pipelineId: string;
  pipelineName: string;
  projectId: string;
  stepKey: string;
  stageLabel: string;
  stageKind: 'approval' | 'eval';
  attempt: number;
  taskStatus: 'todo' | 'in_progress' | 'in_review';
  assignmentKind: 'user' | 'role';
  assignmentRoleKeys: string[];
};

export type InboxItem = InboxNotificationItem | PipelineHitlInboxItem;

export type InboxViewer = {
  userId: string | null;
  roleKeys: readonly string[];
};

const NOTIFICATION_TYPES = new Set<InboxNotificationType>([
  'comment',
  'approval',
  'run_failed',
  'join_request',
  'mention',
  'goal_achieved',
  'paused',
]);
const ENTITY_TYPES = new Set<Exclude<InboxEntityType, null>>([
  'issue',
  'approval',
  'agent',
  'goal',
  'user',
]);
const ACTIONABLE_TASK_STATUSES = new Set(['todo', 'in_progress', 'in_review']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter((item): item is string => item !== null))];
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function notificationItem(value: unknown): InboxNotificationItem | null {
  const row = record(value);
  const id = text(row?.id);
  const type = text(row?.type);
  const title = text(row?.title);
  const createdAt = text(row?.createdAt);
  if (
    !row ||
    !id ||
    !type ||
    !NOTIFICATION_TYPES.has(type as InboxNotificationType) ||
    !title ||
    !createdAt
  ) {
    return null;
  }

  const entityType = text(row.entityType);
  return {
    id,
    type: type as InboxNotificationType,
    title,
    body: nullableText(row.body),
    actorAgentId: nullableText(row.actorAgentId),
    actorUserId: nullableText(row.actorUserId),
    entityType:
      entityType && ENTITY_TYPES.has(entityType as Exclude<InboxEntityType, null>)
        ? (entityType as Exclude<InboxEntityType, null>)
        : null,
    entityId: nullableText(row.entityId),
    href: nullableText(row.href),
    createdAt,
    readAt: nullableText(row.readAt),
  };
}

function isPipelineProjection(value: unknown): boolean {
  const row = record(value);
  return !!row && ('runId' in row || 'stageKey' in row || 'target' in row || 'issueId' in row);
}

function roleIntersection(
  participantRoleKeys: readonly string[],
  targetRoleKeys: readonly string[],
  viewerRoleKeys: readonly string[],
): string[] {
  if (
    participantRoleKeys.length === 0 ||
    targetRoleKeys.length === 0 ||
    viewerRoleKeys.length === 0
  )
    return [];
  const targetRoles = new Set(targetRoleKeys);
  const viewerRoles = new Set(viewerRoleKeys);
  return participantRoleKeys.filter(
    (roleKey) => targetRoles.has(roleKey) && viewerRoles.has(roleKey),
  );
}

/**
 * Normalize a backend-produced current-stage HITL projection. Paperclip's
 * company Inbox query is authoritative for selecting the current child of an
 * active run; Hub independently rejects terminal states and mismatched targets.
 *
 * Expected backend DTO fields are deliberately flat and explicit. This is only
 * a display filter: Paperclip must repeat the same checks when authorizing the
 * eventual stage-task mutation.
 */
function pipelineHitlItem(value: unknown, viewer: InboxViewer): PipelineHitlInboxItem | null {
  const row = record(value);
  if (!row) return null;

  const inboxId = text(row.id);
  const issueId = text(row.issueId);
  const rootIssueId = text(row.rootIssueId);
  const runId = text(row.runId);
  const pipelineId = text(row.pipelineId);
  const pipelineName = text(row.pipelineName);
  const projectId = text(row.projectId);
  const title = text(row.title);
  const createdAt = text(row.createdAt);
  const status = text(row.status);
  const stepKey = text(row.stageKey);
  const stageLabel = text(row.stageLabel);
  const stageKind = text(row.stageKind);
  const attempt = finiteInteger(row.attempt);
  const participantUserId = nullableText(row.participantUserId);
  const participantRoleKeys = texts(row.participantRoleKeys);
  const target = record(row.target);
  const targetType = text(target?.type);
  const targetUserId = nullableText(target?.userId);
  const targetRoleKeys = texts(target?.roleKeys);

  if (
    !inboxId ||
    text(row.type) !== 'approval' ||
    !issueId ||
    !rootIssueId ||
    !runId ||
    !pipelineId ||
    !pipelineName ||
    !projectId ||
    !title ||
    !createdAt ||
    !status ||
    !ACTIONABLE_TASK_STATUSES.has(status) ||
    !stepKey ||
    !stageLabel ||
    (stageKind !== 'approval' && stageKind !== 'eval') ||
    attempt === null ||
    !target
  ) {
    return null;
  }

  // Preserve the exact-user contract. For a role target, require the same role
  // to appear in the backend target, immutable participant snapshot, and this
  // request's server-resolved Hub roles.
  const assignedDirectly =
    !!viewer.userId &&
    targetType === 'user' &&
    targetUserId === viewer.userId &&
    participantUserId === viewer.userId;
  const eligibleRoleKeys =
    targetType === 'role' && !participantUserId && !targetUserId
      ? roleIntersection(participantRoleKeys, targetRoleKeys, viewer.roleKeys)
      : [];
  const assignedByRole = eligibleRoleKeys.length > 0;
  if (!assignedDirectly && !assignedByRole) return null;

  return {
    id: `pipeline-hitl:${inboxId}`,
    type: 'pipeline_hitl',
    title,
    body: nullableText(row.description),
    actorAgentId: null,
    actorUserId: null,
    entityType: 'issue',
    entityId: issueId,
    href: `/workforce/issues/${encodeURIComponent(issueId)}`,
    createdAt,
    readAt: null,
    pipelineRunId: runId,
    rootIssueId,
    pipelineId,
    pipelineName,
    projectId,
    stepKey,
    stageLabel,
    stageKind,
    attempt,
    taskStatus: status as PipelineHitlInboxItem['taskStatus'],
    assignmentKind: assignedDirectly ? 'user' : 'role',
    assignmentRoleKeys: assignedByRole ? eligibleRoleKeys : [],
  };
}

function rows(value: unknown): { notifications: unknown[]; pipelineTasks: unknown[] } {
  if (Array.isArray(value)) return { notifications: value, pipelineTasks: value };
  const root = record(value);
  if (!root) return { notifications: [], pipelineTasks: [] };
  return {
    notifications: Array.isArray(root.items) ? root.items : [],
    pipelineTasks: Array.isArray(root.pipelineTasks)
      ? root.pipelineTasks
      : Array.isArray(root.items)
        ? root.items
        : [],
  };
}

/**
 * Supports both the existing notification array and Paperclip's current HITL
 * projection array. The object form keeps rollout compatibility if either list
 * is wrapped during API version skew.
 */
export function normalizeInboxResponse(value: unknown, viewer: InboxViewer): InboxItem[] {
  const input = rows(value);
  const notifications = input.notifications.flatMap((item) => {
    // A pipeline projection that fails viewer eligibility must disappear; it
    // must never fall back to the legacy, assignment-agnostic approval card.
    if (isPipelineProjection(item)) return [];
    const normalized = notificationItem(item);
    return normalized ? [normalized] : [];
  });
  const pipelineTasks = input.pipelineTasks.flatMap((item) => {
    const normalized = pipelineHitlItem(item, viewer);
    return normalized ? [normalized] : [];
  });

  return [...notifications, ...pipelineTasks].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return 0;
    return rightTime - leftTime;
  });
}
