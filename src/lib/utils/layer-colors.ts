/**
 * Layer color tokens for prompt-section layer badges + dots.
 *
 * Phase 20 CONTEXT specifics: platform=slate, agent-type=blue, identity=violet,
 * user=emerald, session=amber, custom.*=rose. Used by `SectionRow.svelte` and
 * `LayerGroup.svelte` to keep browser + breakdown consistent.
 */

export const LAYER_COLORS: Record<string, { dot: string; badge: string }> = {
  platform: { dot: "bg-slate-500", badge: "bg-slate-500/15 text-slate-300" },
  "agent-type": { dot: "bg-blue-500", badge: "bg-blue-500/15 text-blue-300" },
  identity: { dot: "bg-violet-500", badge: "bg-violet-500/15 text-violet-300" },
  user: { dot: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-300" },
  session: { dot: "bg-amber-500", badge: "bg-amber-500/15 text-amber-300" },
};

const FALLBACK = { dot: "bg-zinc-500", badge: "bg-zinc-500/15 text-zinc-300" };
const CUSTOM = { dot: "bg-rose-500", badge: "bg-rose-500/15 text-rose-300" };

export function colorForLayer(layer: string): { dot: string; badge: string } {
  if (!layer) return FALLBACK;
  if (layer.startsWith("custom")) return CUSTOM;
  return LAYER_COLORS[layer] ?? FALLBACK;
}

/** Canonical order for grouping sections in the browser pane. */
export const LAYER_ORDER: readonly string[] = [
  "platform",
  "agent-type",
  "identity",
  "user",
  "session",
];

/** Pretty label for layer group headers. */
export function layerLabel(layer: string): string {
  if (layer.startsWith("custom")) return "Custom";
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}
