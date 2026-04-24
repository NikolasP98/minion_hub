<script lang="ts">
  import type { SectionMeta } from "@minion-stack/shared";
  import { colorForLayer } from "$lib/utils/layer-colors";
  import ToggleSwitch from "$lib/components/config/ToggleSwitch.svelte";
  import { promptSections } from "$lib/state/features/prompt-sections.svelte";
  import { getSection, setOverrides, upsertSection } from "$lib/services/prompt-sections-rpc";
  import { toastError } from "$lib/state/ui/toast.svelte";

  let {
    section,
    isDisabled,
  }: {
    section: SectionMeta;
    isDisabled: boolean;
  } = $props();

  const color = $derived(colorForLayer(section.layer));
  const isActive = $derived(promptSections.activeId === section.id);

  async function handleClick() {
    if (!promptSections.agentId) return;
    promptSections.activeId = section.id;
    promptSections.validationErrors = [];
    promptSections.isDirty = false;
    try {
      const full = await getSection(promptSections.agentId, section.id);
      promptSections.activeBody = full.render;
    } catch (err) {
      toastError("Failed to load section", (err as Error).message);
    }
  }

  async function handleToggle(nextChecked: boolean) {
    if (!promptSections.agentId) return;
    const agentId = promptSections.agentId;

    // Branch: builtin vs custom (B-1 fix).
    // - Builtin: mutate the overrides.disabled list server-side (no body fetch needed).
    // - Custom:  pre-fetch the full SectionInput via getSection (SectionMeta lacks
    //            `render`), then upsert with the flipped `enabled` flag.
    if (section.source === "builtin") {
      const previous = [...promptSections.disabledOverrides];
      // Optimistic: when enabling (nextChecked=true), REMOVE from disabled list.
      const next = nextChecked
        ? previous.filter((id) => id !== section.id)
        : previous.includes(section.id)
          ? previous
          : [...previous, section.id];
      promptSections.disabledOverrides = next;
      try {
        const res = await setOverrides(agentId, next);
        promptSections.disabledOverrides = res.disabled;
      } catch (err) {
        promptSections.disabledOverrides = previous;
        toastError("Toggle failed", (err as Error).message);
      }
      return;
    }

    // Custom path: optimistic local flip in list, then pre-fetch body, then upsert.
    const previousEnabled = section.enabled;
    const idx = promptSections.sections.findIndex((s) => s.id === section.id);
    if (idx >= 0) {
      promptSections.sections[idx] = { ...section, enabled: nextChecked };
    }
    try {
      const full = await getSection(agentId, section.id);
      const updated = await upsertSection(agentId, {
        id: full.id,
        layer: full.layer,
        order: full.order,
        modes: full.modes,
        cacheable: full.cacheable,
        enabled: nextChecked,
        render: full.render,
      });
      if (idx >= 0) {
        promptSections.sections[idx] = { ...promptSections.sections[idx], ...updated };
      }
    } catch (err) {
      if (idx >= 0) {
        promptSections.sections[idx] = { ...section, enabled: previousEnabled };
      }
      toastError("Toggle failed", (err as Error).message);
    }
  }

  const effectivelyEnabled = $derived(
    section.source === "builtin" ? !isDisabled : section.enabled,
  );
</script>

<div
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }}
  class="flex items-center gap-2 px-3 py-2 border-b border-border cursor-pointer transition-colors
    {isActive ? 'border-accent bg-accent/8 text-accent' : 'hover:bg-bg2'}
    {effectivelyEnabled ? '' : 'opacity-50'}"
>
  <span class="w-1.5 h-1.5 rounded-full shrink-0 {color.dot}"></span>
  <span
    class="text-xs font-mono truncate flex-1 {effectivelyEnabled ? '' : 'line-through'}"
    title={section.id}
  >
    {section.id}
  </span>
  <span class="text-[10px] px-1.5 py-0.5 rounded {color.badge} shrink-0">
    {section.layer}
  </span>
  <span class="text-[10px] text-muted font-mono shrink-0 w-6 text-right">
    {section.order}
  </span>
  {#if !effectivelyEnabled}
    <span
      class="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-zinc-500/20 text-zinc-400 shrink-0"
      >Disabled</span
    >
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span class="shrink-0" onclick={(e) => e.stopPropagation()}>
    <ToggleSwitch
      checked={effectivelyEnabled}
      id={`toggle-${section.id}`}
      onchange={handleToggle}
    />
  </span>
</div>
