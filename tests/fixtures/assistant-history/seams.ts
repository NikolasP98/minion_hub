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
