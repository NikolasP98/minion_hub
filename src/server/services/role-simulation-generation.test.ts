import { describe, expect, it } from 'vitest';
import {
  enforceSimulationGeneration,
  SimulationGenerationConflict,
} from './role-simulation.service';
import { inactiveSimulation } from '$lib/role-simulation';
function event(generation: string, stamp?: string, form = false) {
  const headers = new Headers();
  if (stamp) headers.set('X-Role-Simulation-Generation', stamp);
  const body = form ? new URLSearchParams({ _roleSimulationGeneration: generation }) : '{}';
  return {
    locals: { authSessionId: 'session', roleSimulation: { ...inactiveSimulation(), generation } },
    url: new URL('https://fixture.invalid/api/crm/customers'),
    request: new Request('https://fixture.invalid/api/crm/customers', {
      method: 'POST',
      headers,
      body,
    }),
  } as never;
}
describe('server generation admission', () => {
  it('accepts an unstamped never-transitioned session but rejects missing/stale stamps after Finish too', async () => {
    await expect(
      enforceSimulationGeneration(event(inactiveSimulation().generation)),
    ).resolves.toBeUndefined();
    await expect(enforceSimulationGeneration(event('new-generation'))).rejects.toBeInstanceOf(
      SimulationGenerationConflict,
    );
    await expect(
      enforceSimulationGeneration(event('new-generation', 'old-generation')),
    ).rejects.toMatchObject({ generation: 'new-generation' });
    await expect(
      enforceSimulationGeneration(event('new-generation', 'new-generation')),
    ).resolves.toBeUndefined();
  });
  it('admits native form generation from the body, without trusting URL/cookie state', async () => {
    await expect(
      enforceSimulationGeneration(event('new-generation', undefined, true)),
    ).resolves.toBeUndefined();
  });
});
