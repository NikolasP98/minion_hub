export type PluginSlot =
  | "settings.plugins"
  | "dashboard.widget"
  | "workforce.sidebar";

export interface SlotDefinition {
  /** How the slot host arranges occupants. */
  layout: "tabs" | "cards" | "list";
  /** Human-readable label for diagnostics. */
  label: string;
}

export const SLOT_DEFINITIONS: Record<PluginSlot, SlotDefinition> = {
  "settings.plugins": { layout: "tabs", label: "Settings → Plugins" },
  "dashboard.widget": { layout: "cards", label: "Dashboard widget" },
  "workforce.sidebar": { layout: "list", label: "Workforce sidebar" },
};

const ALL_SLOTS = new Set<string>(Object.keys(SLOT_DEFINITIONS));

export function isPluginSlot(value: string): value is PluginSlot {
  return ALL_SLOTS.has(value);
}
