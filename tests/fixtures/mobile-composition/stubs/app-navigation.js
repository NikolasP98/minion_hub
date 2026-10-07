// Fixture stub for $app/navigation: records intents, never navigates. It also
// announces each intent (`fixture:navigate`) so a fixture that wants to play
// the URL back into the mounted route's `data` — the calendar's view switch
// round trip (HC-016) — can do so without a router.
/** @param {string | URL} url */
export const goto = async (url) => {
  const w = /** @type {Window & { __fixtureNav?: string[] }} */ (window);
  (w.__fixtureNav ??= []).push(String(url));
  window.dispatchEvent(new CustomEvent('fixture:navigate', { detail: String(url) }));
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
