/** Public projection only. Authority is resolved from the verified server session. */
export const INITIAL_SIMULATION_GENERATION = '00000000-0000-0000-0000-000000000000';
export const SIMULATION_GENERATION_HEADER = 'X-Role-Simulation-Generation';
export interface SimulationRole {
  key: string;
  name: string;
  selectable: boolean;
  reason?: 'authority' | 'owner';
}
export interface RoleSimulationState {
  active: boolean;
  invalid: boolean;
  eligible: boolean;
  roleKey: string | null;
  roleName: string | null;
  generation: string;
  orgId: string | null;
  orgName: string | null;
  roles: SimulationRole[];
}
export function inactiveSimulation(): RoleSimulationState {
  return {
    active: false,
    invalid: false,
    eligible: false,
    roleKey: null,
    roleName: null,
    generation: INITIAL_SIMULATION_GENERATION,
    orgId: null,
    orgName: null,
    roles: [],
  };
}
