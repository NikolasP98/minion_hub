import type { PluginSlot } from "./slots";

/** Hub nav taxonomy emitted by the gateway (manifest-declared or inferred). */
export type PluginCategory = "channel" | "automation" | "creative" | "tool" | "dashboard";

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
  status?: "loaded" | "disabled" | "error";
  pluginVersion?: string;
  pluginError?: string;
  configEnabled?: boolean;
}
