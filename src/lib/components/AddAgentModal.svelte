<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import type { Agent } from '$lib/types/gateway';
  import * as popover from '@zag-js/popover';
  import * as combobox from '@zag-js/combobox';
  import { useMachine, normalizeProps } from '@zag-js/svelte';

  // ── Emoji categories ──────────────────────────────────────────────────────
  const EMOJI_CATS = [
    { id: 'tech',    icon: '⚙️', emojis: ['🤖','💻','🖥️','⚙️','🔧','🛠️','🔩','💾','📡','🔌','🧠','🔬'] },
    { id: 'animals', icon: '🐾', emojis: ['🐶','🐱','🦊','🐺','🦁','🐯','🐻','🦅','🐉','🦋','🦜','🐙'] },
    { id: 'nature',  icon: '🌿', emojis: ['🌟','⭐','🌙','☀️','🌊','🔥','❄️','⚡','🌈','🌿','🍀','🌸'] },
    { id: 'objects', icon: '📦', emojis: ['📝','🎯','🎲','🏆','💡','🔑','🎁','🧪','📚','🗺️','🎨','🎭'] },
    { id: 'symbols', icon: '✨', emojis: ['✅','❌','⚠️','🔴','🟡','🟢','🔵','💥','♾️','🎪','🌀','💫'] },
    { id: 'faces',   icon: '😀', emojis: ['😀','😎','🤔','😈','👾','🤠','🥸','🫡','🤫','😴','🤩','🧐'] },
  ];

  // ── Form state ────────────────────────────────────────────────────────────
  let name = $state('');
  let emoji = $state('');
  let saving = $state(false);
  let errorMsg = $state('');
  let nameError = $state('');
  let activeCat = $state('tech');

  // ── Workspace auto-generation ─────────────────────────────────────────────
  let hostUser = $state('minion');
  let configDir = $state('.minion');
  const workspacePath = $derived(
    `/home/${hostUser || 'minion'}/${configDir || '.minion'}/workspaces/${name.trim() || '<agent-name>'}`
  );

  // ── Models ────────────────────────────────────────────────────────────────
  type ModelItem = { id: string; name: string };
  let modelItems = $state<ModelItem[]>([]);
  let defaultModel = $state('');
  let selectedModel = $state('');

  // ── Zag: popover (emoji picker) ───────────────────────────────────────────
  // In Zag.js 1.x, first arg is the machine definition object (not a called function)
  const popoverService = useMachine(popover.machine, () => ({
    id: 'emoji-picker',
    positioning: { placement: 'bottom-start' as const },
  }));
  const popoverApi = $derived(popover.connect(popoverService, normalizeProps));

  // ── Model combobox (fuzzy search via Zag.js) ─────────────────────────────
  let modelQuery = $state('');

  function fuzzyScore(query: string, text: string): number {
    if (!query) return 1;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t.includes(q)) return 100 + (q.length / t.length) * 50;
    let score = 0, qi = 0, lastMatch = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) { score += ti === lastMatch + 1 ? 10 : 1; lastMatch = ti; qi++; }
    }
    return qi === q.length ? score : 0;
  }

  const filteredModels = $derived(
    modelQuery.trim()
      ? modelItems
          .map(m => ({ m, score: Math.max(fuzzyScore(modelQuery, m.id), fuzzyScore(modelQuery, m.name)) }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(x => x.m)
      : modelItems
  );

  // Reactive collection — updates whenever filteredModels changes
  const modelCollection = $derived(
    combobox.collection({
      items: filteredModels,
      itemToValue: (m: ModelItem) => m.id,
      itemToString: (m: ModelItem) => m.name,
    })
  );

  const comboboxService = useMachine(combobox.machine, () => ({
    id: 'model-combobox',
    collection: modelCollection,
    placeholder: 'Search models…',
    selectionBehavior: 'replace' as const,
    openOnClick: true,
    openOnChange: true,
    positioning: { placement: 'bottom-start' as const },
    onInputValueChange({ inputValue }: { inputValue: string }) {
      modelQuery = inputValue;
    },
    onValueChange({ value }: { value: string[] }) {
      selectedModel = value[0] ?? '';
    },
  }));

  const comboboxApi = $derived(combobox.connect(comboboxService, normalizeProps));

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      const res = await sendRequest('models.list', {}) as { models?: ModelItem[]; defaultModel?: string } | null;
      if (res?.models) {
        // Deduplicate by id — guard against both old and new backend responses
        const seen = new Set<string>();
        modelItems = res.models.filter(m => seen.has(m.id) ? false : (seen.add(m.id), true));
      }
      if (res?.defaultModel) {
        defaultModel = res.defaultModel;
        selectedModel = res.defaultModel;
        comboboxApi.setValue([res.defaultModel]);
      }
    } catch {
      modelItems = [];
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function pickEmoji(e: string) {
    emoji = e;
    popoverApi.setOpen(false);
  }

  function resetForm() {
    name = '';
    emoji = '';
    selectedModel = '';
    modelQuery = '';
    comboboxApi.clearValue();
    comboboxApi.setInputValue('');
    hostUser = 'minion';
    configDir = '.minion';
    saving = false;
    errorMsg = '';
    nameError = '';
    activeCat = 'tech';
  }

  function close() {
    ui.agentAddOpen = false;
    resetForm();
  }

  function handleOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function validate(): boolean {
    nameError = '';
    if (!name.trim()) { nameError = 'Name is required'; return false; }
    return true;
  }

  async function submit() {
    if (!validate()) return;
    saving = true;
    errorMsg = '';
    try {
      const workspace = `/home/${hostUser}/${configDir}/workspaces/${name.trim()}`;
      const params: Record<string, string> = { name: name.trim(), workspace };
      if (selectedModel) params.model = selectedModel;
      if (emoji.trim()) params.emoji = emoji.trim();

      const res = await sendRequest('agents.create', params) as { agentId?: string; name?: string; workspace?: string } | null;

      // Verify agents.create returned a valid agent ID — do NOT close on ambiguous success
      const newId = res?.agentId ?? null;
      if (!newId) {
        throw new Error('Agent creation failed: server returned no agent ID');
      }

      // Refresh agents list and confirm the new agent is actually present
      const listRes = await sendRequest('agents.list', {}) as { agents?: Agent[] } | null;
      if (listRes?.agents) {
        gw.agents = listRes.agents;
        if (!listRes.agents.some((a) => (a as { id: string }).id === newId)) {
          throw new Error(`Agent "${name.trim()}" was not found after creation — please refresh`);
        }
      }

      ui.selectedAgentId = newId;
      ui.selectedSessionKey = `agent:${newId}:main`;
      close();
    } catch (e) {
      errorMsg = (e as Error).message ?? 'Failed to create agent';
    } finally {
      saving = false;
    }
  }
</script>

<div
  class="fixed inset-0 z-1000 bg-black/60 flex items-center justify-center"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={close}
  onkeydown={handleOverlayKeydown}
>
  <div
    class="bg-bg2 border border-border rounded-xl w-[480px] max-w-[calc(100vw-40px)] flex flex-col shadow-md"
    role="presentation"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <div class="flex items-center justify-between px-5 pt-4 pb-[14px] border-b border-border shrink-0">
      <span class="text-base font-bold">Add Agent</span>
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer text-xl leading-none px-[6px] py-[2px] rounded-sm transition-colors hover:text-foreground" onclick={close} aria-label="Close">×</button>
    </div>

    <div class="px-5 pt-4 pb-5">
      <div class="grid grid-cols-2 gap-[10px] mb-3">

        <!-- Name row: emoji button + name input -->
        <div class="flex flex-col gap-1 col-span-full">
          <div class="flex gap-2 items-center relative">
            <!-- Emoji picker trigger -->
            <button
              class="w-[34px] h-[34px] shrink-0 aspect-square bg-bg3 border border-border rounded-[5px] text-[15px] cursor-pointer flex items-center justify-center transition-colors hover:not-disabled:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Pick emoji"
              disabled={saving}
              {...popoverApi.getTriggerProps()}
            >{emoji || '🙂'}</button>

            <!-- Popover content (always in DOM per Zag dismissable requirements) -->
            <div {...popoverApi.getPositionerProps()}>
              <div class="absolute z-2000 bg-bg2 border border-border rounded-lg p-2 shadow-md w-[220px]" {...popoverApi.getContentProps()}>
                <div class="flex gap-[2px] mb-[6px] border-b border-border pb-1">
                  {#each EMOJI_CATS as cat (cat.id)}
                    <button
                      class="bg-transparent border-none cursor-pointer text-base px-1 py-[2px] rounded-sm transition-all {activeCat === cat.id ? 'opacity-100 bg-bg3' : 'opacity-50 hover:opacity-80 hover:bg-bg3'}"
                      onclick={() => (activeCat = cat.id)}
                      aria-label={cat.id}
                      title={cat.id}
                    >{cat.icon}</button>
                  {/each}
                </div>
                <div class="grid grid-cols-6 gap-[2px]">
                  {#each EMOJI_CATS.find(c => c.id === activeCat)?.emojis ?? [] as em (em)}
                    <button
                      class="bg-transparent border-none cursor-pointer text-lg p-[3px] rounded-sm leading-none transition-colors hover:bg-bg3"
                      onclick={() => pickEmoji(em)}
                      aria-label={em}
                    >{em}</button>
                  {/each}
                </div>
              </div>
            </div>

            <input
              id="agent-name"
              class="flex-1 h-[34px] box-border bg-bg3 border border-border rounded-[5px] text-foreground px-3 py-0 font-mono text-[15px] font-medium outline-none transition-all placeholder:text-muted-foreground placeholder:font-normal focus:border-accent focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed {nameError ? 'border-destructive!' : ''}"
              type="text"
              bind:value={name}
              placeholder="my-agent"
              disabled={saving}
            />
          </div>
          {#if nameError}
            <span class="text-[10px] text-destructive mt-[1px]">{nameError}</span>
          {/if}
        </div>

        <!-- Workspace auto-generated -->
        <div class="flex flex-col gap-1 col-span-full">
          <div class="flex gap-2 mt-1">
            <div class="flex flex-col gap-[3px] flex-1">
              <label for="ws-user" class="text-[10px] text-muted-foreground">User</label>
              <input
                id="ws-user"
                class="bg-bg3 border border-border rounded-[5px] text-foreground py-1 px-[7px] font-[inherit] text-xs outline-none transition-colors focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
                type="text"
                bind:value={hostUser}
                placeholder="minion"
                disabled={saving}
              />
            </div>
            <div class="flex flex-col gap-[3px] flex-1">
              <label for="ws-dir" class="text-[10px] text-muted-foreground">Config dir</label>
              <input
                id="ws-dir"
                class="bg-bg3 border border-border rounded-[5px] text-foreground py-1 px-[7px] font-[inherit] text-xs outline-none transition-colors focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
                type="text"
                bind:value={configDir}
                placeholder=".minion"
                disabled={saving}
              />
            </div>
          </div>
          <span class="text-[11px] text-muted-foreground">Workspace (auto-generated)</span>
          <div class="font-mono text-xs text-muted bg-bg3 border border-border rounded-[5px] py-[6px] px-[10px] break-all">{workspacePath}</div>
        </div>

        <!-- Model combobox (Zag.js fuzzy search) -->
        <div class="flex flex-col gap-1 col-span-full">
          <div {...comboboxApi.getRootProps()}>
            <label class="text-[11px] text-muted-foreground" {...comboboxApi.getLabelProps()}>Model</label>
            <div class="flex items-center bg-bg3 border border-border rounded-[5px] transition-all focus-within:border-accent focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]" {...comboboxApi.getControlProps()}>
              <input
                class="flex-1 min-w-0 bg-transparent border-none outline-none text-foreground py-[5px] px-[9px] font-[inherit] text-[13px] placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                {...comboboxApi.getInputProps()}
                disabled={saving}
              />
              <button
                class="bg-transparent border-none text-muted-foreground cursor-pointer text-sm px-1 py-0 leading-none shrink-0 transition-colors hover:text-foreground data-[state=hidden]:hidden"
                aria-label="Clear model"
                tabindex="-1"
                {...comboboxApi.getClearTriggerProps()}
              >×</button>
              <button
                class="bg-transparent border-none text-muted-foreground cursor-pointer text-[10px] pr-[9px] pl-[2px] py-0 leading-none shrink-0 transition-colors hover:text-muted"
                tabindex="-1"
                aria-label="Toggle model list"
                {...comboboxApi.getTriggerProps()}
              >▾</button>
            </div>
            <!-- Positioner always in DOM — hidden via data-state when closed -->
            <div class="z-2000 data-[state=closed]:hidden" {...comboboxApi.getPositionerProps()}>
              <div class="bg-bg2 border border-border rounded-md shadow-md overflow-hidden min-w-[200px] hidden:hidden" {...comboboxApi.getContentProps()}>
                <ul class="list-none m-0 p-1 max-h-[200px] overflow-y-auto" {...comboboxApi.getListProps()}>
                  {#each filteredModels as item (item.id)}
                    <li class="group flex items-center gap-[6px] py-[5px] px-2 rounded-sm text-xs cursor-pointer transition-colors data-[highlighted]:bg-bg3" {...comboboxApi.getItemProps({ item })}>
                      <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap group-data-[selected]:text-accent group-data-[selected]:font-semibold" {...comboboxApi.getItemTextProps({ item })}>{item.name}</span>
                      {#if item.id === defaultModel}
                        <span class="text-[10px] text-accent bg-accent/15 rounded-[3px] py-[1px] px-[5px] shrink-0">default</span>
                      {/if}
                      <span class="text-muted-foreground text-[11px] font-mono shrink-0">{item.id}</span>
                    </li>
                  {/each}
                  {#if filteredModels.length === 0}
                    <li class="p-2 text-muted-foreground text-xs italic">No matches</li>
                  {/if}
                </ul>
              </div>
            </div>
          </div>
        </div>

      </div>

      {#if errorMsg}
        <div class="bg-destructive/10 border border-destructive/30 rounded-md text-destructive text-xs py-2 px-3 mb-3">{errorMsg}</div>
      {/if}

      <div class="flex gap-2 justify-end">
        <button class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer font-[inherit] text-xs py-[6px] px-3 transition-colors hover:not-disabled:text-muted disabled:opacity-50 disabled:cursor-not-allowed" onclick={close} disabled={saving}>Cancel</button>
        <button class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-4 transition-[filter] hover:not-disabled:brightness-115 disabled:opacity-50 disabled:cursor-not-allowed" onclick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create Agent'}
        </button>
      </div>
    </div>
  </div>
</div>
