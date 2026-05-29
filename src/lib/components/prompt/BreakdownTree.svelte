<script lang="ts">
  import type { SectionMeta } from "@minion-stack/shared";
  import { promptSections, patchUsage, toggleSelected, toggleGroupSelected, toggleLayerCollapsed } from "$lib/state/features/prompt-sections.svelte";
  import { colorForLayer, LAYER_ORDER, layerLabel } from "$lib/utils/layer-colors";
  import { formatBytes } from "$lib/utils/format";
  import { getOverrides, getSection, getSectionUsage, listSections, setOverrides, upsertSection } from "$lib/services/prompt-sections-rpc";
  import { toastError } from "$lib/state/ui/toast.svelte";
  import ToggleSwitch from "$lib/components/config/ToggleSwitch.svelte";
  import SectionCheckbox from "./SectionCheckbox.svelte";
  import AgentAvatarStack from "./AgentAvatarStack.svelte";

  // Phase 25 — usage map fetch + reactive refresh.
  // Initial pull on mount; refetch whenever the gateway broadcasts a
  // prompt.section.* event (override/upsert/delete from any source).
  async function refetchUsage() {
    try {
      promptSections.usage = await getSectionUsage();
    } catch {
      // soft-fail — feature is non-critical
    }
  }
  $effect(() => {
    void refetchUsage();
    if (typeof window === "undefined") return;
    const onChanged = () => void refetchUsage();
    window.addEventListener("prompt.sections.changed", onChanged);
    return () => window.removeEventListener("prompt.sections.changed", onChanged);
  });

  // Resolve the currently-selected agent's identity from the usage map (any
  // section it appears in carries the same ref) — used for optimistic patches.
  function selfRef() {
    const id = promptSections.agentId;
    if (!id) return null;
    for (const refs of Object.values(promptSections.usage)) {
      const found = refs.find((r) => r.agentId === id);
      if (found) return found;
    }
    return { agentId: id, label: id } as const;
  }

  // Fetch the section list + overrides whenever the active agent changes.
  // (Previously lived in the deleted SectionBrowser component.)
  let loadToken = 0;
  $effect(() => {
    const agentId = promptSections.agentId;
    if (!agentId) return;
    const token = ++loadToken;
    promptSections.isLoading = true;
    (async () => {
      try {
        const [sections, overrides] = await Promise.all([
          listSections(agentId),
          getOverrides(agentId),
        ]);
        if (token !== loadToken) return;
        promptSections.sections = sections;
        promptSections.disabledOverrides = overrides.disabled;
      } catch (err) {
        if (token !== loadToken) return;
        toastError("Failed to load prompt sections", (err as Error).message);
      } finally {
        if (token === loadToken) promptSections.isLoading = false;
      }
    })();
  });

  // Group sections by layer using preview.breakdown for byte/token totals when
  // available, falling back to the raw section list. Custom sections collapse
  // into a "custom" pseudo-group regardless of their `custom.*` sublayer.
  const grouped = $derived.by(() => {
    const breakdown = promptSections.preview?.breakdown ?? [];
    const byId = new Map(breakdown.map((b) => [b.id, b]));

    const map = new Map<string, SectionMeta[]>();
    for (const s of promptSections.sections) {
      const key = s.layer.startsWith("custom") ? "custom" : s.layer;
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }
    const order = [...LAYER_ORDER, "custom"];
    return order
      .map((key) => ({ key, items: map.get(key) ?? [] }))
      .filter((g) => g.items.length > 0)
      .map((g) => {
        let bytes = 0;
        let tokens = 0;
        for (const s of g.items) {
          const b = byId.get(s.id);
          if (b) {
            bytes += b.bytes;
            tokens += b.tokens;
          }
        }
        return { ...g, bytes, tokens, byId };
      });
  });

  const selected = $derived(promptSections.selectedIds);
  const collapsed = $derived(promptSections.collapsedGroups);
  const disabled = $derived(promptSections.disabledOverrides);

  function isEffectivelyEnabled(s: SectionMeta) {
    return s.source === "builtin" ? !disabled.includes(s.id) : s.enabled;
  }

  // Per-group tristate for the parent checkbox.
  function groupState(items: SectionMeta[]): "none" | "partial" | "all" {
    let count = 0;
    for (const s of items) if (selected.has(s.id)) count++;
    if (count === 0) return "none";
    if (count === items.length) return "all";
    return "partial";
  }

  async function handleToggleEnabled(section: SectionMeta, nextChecked: boolean) {
    if (!promptSections.agentId) return;
    const agentId = promptSections.agentId;
    if (section.source === "builtin") {
      const previous = [...promptSections.disabledOverrides];
      const next = nextChecked
        ? previous.filter((id) => id !== section.id)
        : previous.includes(section.id) ? previous : [...previous, section.id];
      promptSections.disabledOverrides = next;
      const me = selfRef();
      if (me) patchUsage(section.id, me, nextChecked);
      try {
        const res = await setOverrides(agentId, next);
        promptSections.disabledOverrides = res.disabled;
      } catch (err) {
        promptSections.disabledOverrides = previous;
        if (me) patchUsage(section.id, me, !nextChecked);
        toastError("Toggle failed", (err as Error).message);
      }
      return;
    }
    const previousEnabled = section.enabled;
    const idx = promptSections.sections.findIndex((s) => s.id === section.id);
    if (idx >= 0) promptSections.sections[idx] = { ...section, enabled: nextChecked };
    const me = selfRef();
    if (me) patchUsage(section.id, me, nextChecked);
    try {
      const full = await getSection(agentId, section.id);
      const updated = await upsertSection(agentId, {
        id: full.id, layer: full.layer, order: full.order, modes: full.modes,
        cacheable: full.cacheable, enabled: nextChecked, render: full.render,
      });
      if (idx >= 0) promptSections.sections[idx] = { ...promptSections.sections[idx], ...updated };
    } catch (err) {
      if (idx >= 0) promptSections.sections[idx] = { ...section, enabled: previousEnabled };
      if (me) patchUsage(section.id, me, !nextChecked);
      toastError("Toggle failed", (err as Error).message);
    }
  }

  // Aggregate union of agents across a group's items, dedupe by agentId.
  function groupAgents(items: SectionMeta[]) {
    const seen = new Map<string, ReturnType<typeof selfRef> & { agentId: string; label: string }>();
    for (const s of items) {
      const refs = promptSections.usage[s.id] ?? [];
      for (const r of refs) if (!seen.has(r.agentId)) seen.set(r.agentId, r);
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  function checkboxState(items: SectionMeta[]): "off" | "on" | "mixed" {
    const s = groupState(items);
    return s === "all" ? "on" : s === "partial" ? "mixed" : "off";
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <div class="shrink-0 px-3 py-2 border-b border-border flex items-center justify-between text-xs">
    <span class="uppercase tracking-wider text-muted font-medium">Sections</span>
    <span class="font-mono text-muted">
      {selected.size}/{promptSections.sections.length}
    </span>
  </div>

  <div class="flex-1 overflow-y-auto overflow-x-hidden">
    {#if promptSections.isLoading && promptSections.sections.length === 0}
      <div class="flex flex-col gap-2 p-3">
        {#each Array(6) as _, i (i)}
          <div class="h-7 rounded bg-bg2 animate-pulse"></div>
        {/each}
      </div>
    {:else if grouped.length === 0}
      <div class="p-4 text-xs text-muted">No sections.</div>
    {:else}
      {#each grouped as group (group.key)}
        {@const color = colorForLayer(group.key)}
        {@const state = groupState(group.items)}
        {@const isOpen = !collapsed.has(group.key)}
        {@const activeCount = group.items.filter((s) => isEffectivelyEnabled(s)).length}
        <!-- Group header -->
        <div
          class="flex items-center gap-2 px-2 py-1.5 border-b border-border/60 bg-bg sticky top-0 z-10"
        >
          <button
            type="button"
            class="w-4 h-4 flex items-center justify-center text-muted hover:text-fg shrink-0"
            aria-label={isOpen ? "Collapse" : "Expand"}
            onclick={() => toggleLayerCollapsed(group.key)}
          >
            <svg viewBox="0 0 12 12" class="w-3 h-3 transition-transform {isOpen ? 'rotate-90' : ''}">
              <path d="M4 2 L8 6 L4 10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <SectionCheckbox
            state={checkboxState(group.items)}
            label={`Select all ${layerLabel(group.key)}`}
            onchange={() => toggleGroupSelected(group.key, group.items.map((s) => s.id))}
          />
          <span class="w-1.5 h-1.5 rounded-full shrink-0 {color.dot}"></span>
          <span class="text-[11px] uppercase tracking-wider font-semibold text-fg flex-1 truncate">
            {layerLabel(group.key)}
          </span>
          <AgentAvatarStack agents={groupAgents(group.items)} max={4} size={16} />
          <!-- Mirror item-row right-stack widths so columns align: order(w-9) bytes(w-12) cacheable(w-3) toggle(w-8) -->
          <span class="w-9 shrink-0" aria-hidden="true"></span>
          <span class="text-[10px] text-muted-strong font-mono shrink-0 tabular-nums w-12 text-right">
            {group.bytes > 0 ? formatBytes(group.bytes) : ""}
          </span>
          <span class="w-3 shrink-0" aria-hidden="true"></span>
          <span class="text-[10px] text-muted font-mono shrink-0 tabular-nums w-8 text-right" title="active / total">
            {activeCount}/{group.items.length}
          </span>
        </div>

        {#if isOpen}
          {#each group.items as section (section.id)}
            {@const meta = group.byId.get(section.id)}
            {@const isSelected = selected.has(section.id)}
            {@const enabled = isEffectivelyEnabled(section)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              role="button"
              tabindex="0"
              class="group relative flex items-center gap-2 pl-10 pr-2 py-1 border-b border-border/30 cursor-pointer transition-colors
                {isSelected ? 'bg-accent/10' : 'hover:bg-bg2/40'}
                {enabled ? '' : 'opacity-50'}"
              onclick={(e) => {
                if ((e.target as HTMLElement).closest("[data-no-toggle]")) return;
                toggleSelected(section.id);
              }}
              data-section-id={section.id}
            >
              <span class="absolute left-4 top-0 bottom-0 w-px bg-border/40" aria-hidden="true"></span>
              <span data-no-toggle>
                <SectionCheckbox
                  state={isSelected ? "on" : "off"}
                  label={`Select ${section.id}`}
                  onchange={() => toggleSelected(section.id)}
                />
              </span>
              <span
                class="text-xs font-mono truncate flex-1 {enabled ? 'text-fg' : 'text-muted line-through'}"
                title={section.id}
              >
                {section.id}
              </span>
              <span class="text-[10px] text-muted-strong font-mono shrink-0 tabular-nums w-9 text-right">
                {section.order}
              </span>
              <span class="text-[10px] text-muted-strong font-mono shrink-0 tabular-nums w-12 text-right">
                {meta ? formatBytes(meta.bytes) : ""}
              </span>
              <span class="text-[10px] text-muted-strong shrink-0 w-3 text-center" title={meta?.cacheable ? "Cacheable" : ""}>
                {meta?.cacheable ? "⚡" : ""}
              </span>
              <span data-no-toggle class="shrink-0">
                <ToggleSwitch
                  checked={enabled}
                  id={`bt-${section.id}`}
                  onchange={(v) => handleToggleEnabled(section, v)}
                />
              </span>
            </div>
          {/each}
        {/if}
      {/each}
    {/if}
  </div>
</div>
