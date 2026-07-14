import { redirect, error } from '@sveltejs/kit';
import { workforceRawFetch, workforceServerClient } from '$lib/server/workforce-fetch';
import { normalizePipelineTrace, pipelineRunId } from '$lib/workforce/pipeline-trace';
import { normalizeFactoryIntake } from '$lib/workforce/factory-intake';
import type { PageServerLoad } from './$types';

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || !('status' in value)) return undefined;
  const status = (value as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) throw redirect(302, '/login');
  const { workforceAvailable } = await event.parent();
  if (!event.locals.workforceIdentity?.companyId) {
    throw redirect(302, '/workforce/welcome?reason=no-company');
  }
  const companyId = event.locals.workforceIdentity.companyId;
  const issueId = event.params.id;
  const client = workforceServerClient(event);
  const viewerRoleKeys =
    event.locals.workforceIdentity.roleAuthority === 'signed'
      ? event.locals.workforceIdentity.roleKeys
      : [];

  try {
    const [
      issue,
      comments,
      documents,
      workProducts,
      approvals,
      children,
      agents,
      decisions,
      pipelineRunRaw,
    ] = await Promise.all([
      client.issues.get(issueId),
      client.issues.listComments(issueId),
      client.issues.listDocuments(issueId),
      client.issues.listWorkProducts(issueId),
      client.issues.listApprovals(issueId),
      client.issues.list(companyId, { parentId: issueId }),
      client.agents.list(companyId),
      client.issues.listExecutionDecisions(issueId).catch(() => []),
      workforceRawFetch(event, `/api/issues/${encodeURIComponent(issueId)}/pipeline-run`).catch(
        () => null,
      ),
    ]);
    const runId = pipelineRunId(pipelineRunRaw);
    const pipelineEventsRaw = runId
      ? await workforceRawFetch(
          event,
          `/api/issue-pipeline-runs/${encodeURIComponent(runId)}/events`,
        ).catch(() => [])
      : [];
    const pipelineTrace = normalizePipelineTrace(pipelineRunRaw, pipelineEventsRaw);
    const issueHierarchy = issue as typeof issue & {
      parentId?: string | null;
      ancestors?: Array<{ id: string }>;
    };
    const rootIssueId = issueHierarchy.ancestors?.[0]?.id ?? issueHierarchy.parentId ?? issue.id;
    const factoryIntake =
      pipelineTrace?.currentStepKey === 'routing-decision'
        ? normalizeFactoryIntake(
            await workforceRawFetch(
              event,
              `/api/factory-intakes/${encodeURIComponent(rootIssueId)}`,
            ).catch(() => null),
          )
        : null;

    const agentNames: Record<string, string> = {};
    for (const a of agents) agentNames[a.id] = a.name;

    return {
      issue,
      comments,
      documents,
      workProducts,
      approvals,
      children,
      agentNames,
      decisions,
      pipelineTrace,
      factoryIntake,
      viewerUserId: event.locals.workforceIdentity.userId,
      viewerRoleKeys,
      workforceAvailable,
    };
  } catch (cause: unknown) {
    const status = statusOf(cause);
    throw error(status ?? 502, status === 404 ? 'issue not found' : 'paperclip unavailable');
  }
};
