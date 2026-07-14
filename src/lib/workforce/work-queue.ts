import {
  normalizeInboxResponse,
  type InboxViewer,
  type PipelineHitlInboxItem,
} from './pipeline-inbox';

/** A Workforce HITL gate projected into Hub's canonical /work queue. */
export type WorkforceWorkItem = {
  docType: 'workforce_hitl';
  id: string;
  humanId: string | null;
  title: string;
  status: string;
  href: string;
  createdAt: string;
  pipelineName: string;
  stageLabel: string;
  assignmentKind: PipelineHitlInboxItem['assignmentKind'];
  assignmentRoleKeys: string[];
};

/**
 * Reuse the same fail-closed assignment projection as the legacy Workforce
 * Inbox, then narrow it to actionable pipeline gates for Hub's My Work queue.
 */
export function workforceWorkItems(value: unknown, viewer: InboxViewer): WorkforceWorkItem[] {
  return normalizeInboxResponse(value, viewer).flatMap((item) => {
    if (item.type !== 'pipeline_hitl') return [];
    return [
      {
        docType: 'workforce_hitl' as const,
        id: item.id,
        humanId: null,
        title: item.title,
        status: item.taskStatus,
        href: item.href,
        createdAt: item.createdAt,
        pipelineName: item.pipelineName,
        stageLabel: item.stageLabel,
        assignmentKind: item.assignmentKind,
        assignmentRoleKeys: item.assignmentRoleKeys,
      },
    ];
  });
}
