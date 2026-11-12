import { requireAuth } from '$server/auth/authorize';
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
  loadRoleSimulationState,
  transitionRoleSimulation,
  SimulationGenerationConflict,
} from '$server/services/role-simulation.service';
import { SIMULATION_GENERATION_HEADER } from '$lib/role-simulation';
const base = z.object({ generation: z.uuid(), returnTo: z.string().max(4096) }).strict();
const start = base.extend({ roleKey: z.string().min(1).max(256) }).strict();
const headers = { 'Cache-Control': 'private, no-store' };
export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  return json(await loadRoleSimulationState(locals), { headers });
};
async function transition(event: Parameters<RequestHandler>[0], entering: boolean) {
  if (!event.locals.user) throw error(401);
  if (event.request.headers.get('origin') !== event.url.origin)
    throw error(403, 'Same-origin request required');
  const parsed = (entering ? start : base).safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid role simulation request');
  try {
    return json(await transitionRoleSimulation(event.locals, parsed.data), { headers });
  } catch (cause) {
    if (cause instanceof SimulationGenerationConflict)
      return json(
        { code: 'ROLE_SIMULATION_GENERATION_CONFLICT', message: cause.message },
        {
          status: 409,
          headers: { ...headers, [SIMULATION_GENERATION_HEADER]: cause.generation },
        },
      );
    throw cause;
  }
}
export const POST: RequestHandler = (event) => transition(event, true);
export const DELETE: RequestHandler = (event) => transition(event, false);
