import { redirect, error } from '@sveltejs/kit';
import { workforceRawFetch, workforceServerClient } from '$lib/server/workforce-fetch';
import { normalizePipelineTrace, pipelineRunId } from '$lib/workforce/pipeline-trace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) throw redirect(302, '/login');
  if (!event.locals.workforceIdentity?.companyId) {
    throw redirect(302, '/workforce/welcome?reason=no-company');
  }
  const companyId = event.locals.workforceIdentity.companyId;
  const issueId = event.params.id;
  const client = workforceServerClient(event);

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
    };
  } catch (e: any) {
    throw error(e?.status ?? 502, e?.status === 404 ? 'issue not found' : 'paperclip unavailable');
  }
};
