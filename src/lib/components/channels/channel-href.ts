/**
 * Where a channel card links (spec 043). A gateway channel's control center needs the shared
 * gateway token, so without `ai` it links to the comms settings tab instead (R8). Gmail is hub-native.
 */
export function channelHref(pluginId: string, ai: boolean): string {
  return ai || pluginId === 'gmail' ? `/channels/${pluginId}` : '/settings?s=comms';
}

/** `iframe` link entries embed a plugin UI that needs the shared gateway token (R8): not rendered without `ai`. */
export function visibleLinkPlugins<T extends { link: { mode: string } }>(
  plugins: T[],
  ai: boolean,
): T[] {
  return ai ? plugins : plugins.filter((p) => p.link.mode !== 'iframe');
}
