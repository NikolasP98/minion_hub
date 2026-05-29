<script lang="ts">
  import {
    flowEditorState,
    descriptorForNode,
    updateNodeConfig,
    closeNodeConfig,
  } from '$lib/state/features/flow-editor.svelte';
  import { X, Settings2 } from 'lucide-svelte';

  // The node currently being configured + its plugin-declared field defs.
  const node = $derived(flowEditorState.nodes.find((n) => n.id === flowEditorState.configNodeId));
  const descriptor = $derived(descriptorForNode(node));
  const fields = $derived(descriptor?.config ?? []);
  const config = $derived(((node?.data as { config?: Record<string, unknown> })?.config ?? {}) as Record<string, unknown>);
  const nodeLabel = $derived((node?.data as { label?: string })?.label ?? descriptor?.label ?? 'Node');

  function set(key: string, value: unknown) {
    if (node) updateNodeConfig(node.id, key, value);
  }

  /** Stored value, falling back to the field's declared default for display. */
  function disp(field: { key: string; default?: string | number | boolean }): string {
    const v = config[field.key] ?? field.default;
    return v === undefined || v === null ? '' : String(v);
  }
</script>

{#if node && fields.length > 0}
  <div
    class="absolute top-3 right-3 z-30 w-72 max-h-[calc(100%-1.5rem)] overflow-y-auto bg-bg2 border border-border rounded-xl shadow-xl flex flex-col"
    role="dialog"
    tabindex="-1"
    aria-label="Node configuration"
  >
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <Settings2 size={13} class="text-accent shrink-0" />
        <div class="min-w-0">
          <div class="text-xs font-semibold text-foreground truncate">{nodeLabel}</div>
          <div class="text-[10px] text-muted truncate">{descriptor?.pluginId} · configure</div>
        </div>
      </div>
      <button
        onclick={closeNodeConfig}
        class="p-1 rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors shrink-0"
        title="Close"
        aria-label="Close configuration"
      >
        <X size={14} />
      </button>
    </div>

    <div class="px-3 py-3 flex flex-col gap-3">
      {#each fields as field (field.key)}
        <div class="flex flex-col gap-1">
          {#if field.type === 'boolean'}
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                class="w-3.5 h-3.5 accent-accent"
                checked={config[field.key] === true}
                onchange={(e) => set(field.key, (e.target as HTMLInputElement).checked)}
              />
              <span class="text-xs font-medium text-foreground">{field.label}</span>
            </label>
          {:else}
            <label for="cfg-{field.key}" class="text-[11px] font-medium text-foreground">{field.label}</label>
            {#if field.type === 'select'}
              <select
                id="cfg-{field.key}"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
                value={disp(field)}
                onchange={(e) => set(field.key, (e.target as HTMLSelectElement).value)}
              >
                {#each field.options ?? [] as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            {:else if field.type === 'textarea'}
              <textarea
                id="cfg-{field.key}"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground resize-y min-h-16 font-mono"
                placeholder={field.placeholder}
                value={disp(field)}
                oninput={(e) => set(field.key, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            {:else if field.type === 'number'}
              <input
                id="cfg-{field.key}"
                type="number"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
                placeholder={field.placeholder}
                value={disp(field)}
                oninput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  set(field.key, v === '' ? undefined : Number(v));
                }}
              />
            {:else}
              <input
                id="cfg-{field.key}"
                type="text"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
                placeholder={field.placeholder}
                value={disp(field)}
                oninput={(e) => set(field.key, (e.target as HTMLInputElement).value)}
              />
            {/if}
          {/if}
          {#if field.description}
            <p class="text-[10px] text-muted leading-snug">{field.description}</p>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
