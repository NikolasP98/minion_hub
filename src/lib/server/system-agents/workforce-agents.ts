import type { RequestEvent } from '@sveltejs/kit';
import { workforceServerClient } from '$lib/server/workforce-fetch';
import { workforceAgentToVM, type AutonomousAgentVM } from '$lib/agents/autonomous';
import * as m from '$lib/paraglide/messages';

/**
 * Load the active org's Workforce agents as autonomous-agent VMs. Every
 * Workforce agent is event-driven (it acts on issue create/update events), so
 * they surface on /agents/autonomous — segregated into their own module group.
 *
 * Soft-fails to [] when Workforce isn't wired for this org (no company id, no
 * board key, backend unreachable) so the autonomous page never 500s on it.
 */
export async function loadWorkforceAgentVMs(event: RequestEvent): Promise<AutonomousAgentVM[]> {
  const companyId = event.locals.workforceIdentity?.companyId;
  if (!companyId) return [];
  try {
    const agents = await workforceServerClient(event).agents.list(companyId);
    const trigger = m.autonomous_workforce_trigger();
    return agents.map((a) =>
      workforceAgentToVM(
        {
          id: a.id,
          name: a.name,
          role: a.role,
          title: a.title,
          status: a.status,
          capabilities: a.capabilities,
        },
        trigger,
      ),
    );
  } catch {
    return [];
  }
}
