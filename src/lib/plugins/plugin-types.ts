import type { PluginSlot } from "./slots";

/**
 * Hub nav taxonomy emitted by the gateway (manifest-declared or inferred).
 * Business-domain values (marketing/operations/customer-support) drive the
 * sidebar groups; legacy values (automation/dashboard) are remapped in
 * `sections.ts#normalizePluginCategory`. `channel` plugins render under the
 * Customer Support → Channels subsection.
 */
export type PluginCategory =
  | "channel"
  | "automation"
  | "creative"
  | "tool"
  | "dashboard"
  | "marketing"
  | "operations"
  | "customer-support";

export interface PluginUiManifestOccupant {
  pluginId: string;
  slot: PluginSlot;
  title: string;
  description: string;
  entrypoint: string;
  icon?: string;
  /** Taxonomy for nav grouping. Defaults to "tool" when absent (back-compat). */
  category?: PluginCategory;
  enabled?: boolean;
  status?: "loaded" | "disabled" | "error" | "incompatible";
  pluginVersion?: string;
  pluginError?: string;
  configEnabled?: boolean;
  /**
   * Compatibility constraints declared in the plugin manifest. Used to gate the
   * UI against the connected gateway's advertised capabilities
   * (`gw.hello.features.methods` / `server.version`) and the host bridge
   * protocol before mounting. Absent ⇒ no constraints (always compatible).
   */
  compat?: PluginCompat;
}

/**
 * Plugin compatibility constraints. Mirrors `PluginCompat` in the gateway's
 * manifest (minion/src/plugins/manifest.ts), projected here via plugins.ui.list.
 */
export interface PluginCompat {
  /** Minimum gateway CalVer this plugin supports, e.g. "2026.6.0". */
  minGatewayVersion?: string;
  /** Plugin-UI bridge protocol major the UI was built against, e.g. "1". */
  bridgeProtocol?: string;
  /** Gateway RPC methods the plugin's UI calls (host-side capability gating). */
  requiredRpc?: string[];
}
