import type { PluginSlot } from "./slots";

export interface PluginUiManifestOccupant {
  pluginId: string;
  slot: PluginSlot;
  title: string;
  description: string;
  entrypoint: string;
  icon?: string;
  enabled?: boolean;
  status?: "loaded" | "disabled" | "error";
  pluginVersion?: string;
  pluginError?: string;
  configEnabled?: boolean;
}
