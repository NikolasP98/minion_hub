export const toolCatalog = { byId: {} };
export function ensureToolCatalogLoaded() {}
export function useAliasDirectory() {}
export function getAliases() {
  return {};
}
export const navigations: string[] = [];
export function goto(path: string) {
  navigations.push(path);
}
export function canViewPath() {
  return true;
}
export function canAct() {
  return true;
}
export async function invalidate() {}
export async function preloadData() {
  return { type: 'loaded', status: 200, data: {} };
}
export function pushState() {}
export function afterNavigate() {}

// No gateway, voice session or backend is used by the rendered shell fixture.
export function sendAssistantTurn() {}
export function abortChat() {}
export function loadChatHistory() {}
export function cleanInboundForDisplay(text: string) {
  return text;
}
export function isActionToken() {
  return false;
}
export function resetChat() {}
export const voiceCall = { active: false, status: 'idle' };
export const mouth = { open: 0 };
export function toggleMute() {}
export function endCall() {}
