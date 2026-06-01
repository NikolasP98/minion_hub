import type { PluginUiManifestOccupant } from '$lib/plugins/plugin-types';

/**
 * Block the flow editor only when a flows plugin entry exists AND is explicitly
 * disabled. Absent entry or absent flag ⇒ allow (fail-open / back-compat).
 */
export function shouldBlockFlowEditor(
  entries: Pick<PluginUiManifestOccupant, 'pluginId' | 'configEnabled'>[],
): boolean {
  const flows = entries.find((e) => e.pluginId === 'flows');
  return !!flows && flows.configEnabled === false;
}
