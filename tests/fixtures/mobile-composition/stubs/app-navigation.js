// Fixture stub for $app/navigation: records intents, never navigates.
/** @param {string | URL} url */
export const goto = async (url) => {
  const w = /** @type {Window & { __fixtureNav?: string[] }} */ (window);
  (w.__fixtureNav ??= []).push(String(url));
};
export const invalidate = async () => {};
export const invalidateAll = async () => {};
export const preloadData = async () => {};
export const preloadCode = async () => {};
export const beforeNavigate = () => {};
export const afterNavigate = () => {};
export const onNavigate = () => {};
export const pushState = () => {};
export const replaceState = () => {};
export const disableScrollHandling = () => {};
