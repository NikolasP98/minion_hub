// Unrelated Gateway resources are disconnected in this alias-only fixture.
export const browser = true;
export const dev = false;
export const building = false;
export const visibleAgents = { value: [] };
export const conn = { connected: false };
// Also supports the alias-only checkpoint before the HC036 resource migration.
export const agentSkillsState = { skills: [] };
export const loadAgentSkills = async () => {};
export const captureAgentResourceOwner = () => null;
export const captureGatewayResourceOwner = () => null;
export const createAgentSkillsResource = () => ({
  data: null,
  reset() {},
  dispose() {},
  load: async () => {},
});
export const gatewayToolCatalog = { data: null, ensure: async () => {} };
export const channelPlugins = () => [];
export const ensureChannelPlugins = async () => [];
export function captureException() {}
export default { capture() {} };
