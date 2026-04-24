<script lang="ts">
  import type { PromptMode, SectionFull, SectionLayer } from "@minion-stack/shared";
  import { colorForLayer } from "$lib/utils/layer-colors";
  import ToggleSwitch from "$lib/components/config/ToggleSwitch.svelte";

  let {
    section,
    readonly = false,
    onchange,
  }: {
    section: SectionFull;
    readonly?: boolean;
    onchange?: (patch: Partial<SectionFull>) => void;
  } = $props();

  const color = $derived(colorForLayer(section.layer));

  const MODES: PromptMode[] = ["full", "minimal", "none"];
  const LAYERS: SectionLayer[] = [
    "platform",
    "agent-type",
    "identity",
    "user",
    "session",
  ];

  function toggleMode(mode: PromptMode) {
    if (readonly) return;
    const has = section.modes.includes(mode);
    const next = has ? section.modes.filter((m) => m !== mode) : [...section.modes, mode];
    onchange?.({ modes: next });
  }
</script>

<div
  class="shrink-0 border-t border-border bg-bg2 p-3 flex flex-col gap-2 text-xs"
>
  <div class="flex items-center gap-3 flex-wrap">
    <div class="flex items-center gap-1.5">
      <span class="text-muted">id</span>
      <span class="font-mono">{section.id}</span>
    </div>
    <div class="flex items-center gap-1.5">
      <span class="text-muted">layer</span>
      {#if readonly || section.source === "builtin"}
        <span class="px-1.5 py-0.5 rounded {color.badge}">{section.layer}</span>
      {:else}
        <select
          class="bg-bg border border-border rounded px-1.5 py-0.5 text-xs"
          value={section.layer}
          onchange={(e) =>
            onchange?.({ layer: (e.currentTarget as HTMLSelectElement).value as SectionLayer })}
        >
          {#each LAYERS as l (l)}
            <option value={l}>{l}</option>
          {/each}
        </select>
      {/if}
    </div>
    <div class="flex items-center gap-1.5">
      <span class="text-muted">order</span>
      <input
        type="number"
        class="bg-bg border border-border rounded px-1.5 py-0.5 w-16 text-xs disabled:opacity-50"
        value={section.order}
        disabled={readonly}
        oninput={(e) =>
          onchange?.({ order: Number((e.currentTarget as HTMLInputElement).value) })}
      />
    </div>
    <div class="flex items-center gap-1.5">
      <span class="text-muted">cacheable</span>
      <ToggleSwitch
        id={`cacheable-${section.id}`}
        checked={section.cacheable}
        onchange={(v) => !readonly && onchange?.({ cacheable: v })}
      />
    </div>
    <div class="flex items-center gap-1.5">
      <span class="text-muted">enabled</span>
      <ToggleSwitch
        id={`enabled-${section.id}`}
        checked={section.enabled}
        onchange={(v) => !readonly && onchange?.({ enabled: v })}
      />
    </div>
  </div>
  <div class="flex items-center gap-2 flex-wrap">
    <span class="text-muted">modes</span>
    {#each MODES as m (m)}
      {@const active = section.modes.includes(m)}
      <button
        type="button"
        disabled={readonly}
        onclick={() => toggleMode(m)}
        class="px-2 py-0.5 rounded border text-[11px] font-mono transition-colors disabled:opacity-50
          {active ? 'bg-accent/15 border-accent text-accent' : 'bg-bg border-border text-muted hover:text-text'}"
      >
        {m}
      </button>
    {/each}
  </div>
</div>
