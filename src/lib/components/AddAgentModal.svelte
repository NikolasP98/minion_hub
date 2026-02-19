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
      close();
    } catch (e) {
      errorMsg = (e as Error).message ?? 'Failed to create agent';
    } finally {
      saving = false;
    }
  }
</script>

<div
  class="overlay"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={close}
  onkeydown={handleOverlayKeydown}
>
  <div
    class="panel"
    role="presentation"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <div class="panel-header">
      <span class="panel-title">Add Agent</span>
      <button class="close-btn" onclick={close} aria-label="Close">×</button>
    </div>

    <div class="panel-body">
      <div class="form-fields">

        <!-- Name row: emoji button + name input -->
        <div class="form-field full-width">
          <div class="name-row">
            <!-- Emoji picker trigger -->
            <button
              class="emoji-btn"
              aria-label="Pick emoji"
              disabled={saving}
              {...popoverApi.getTriggerProps()}
            >{emoji || '🙂'}</button>

            <!-- Popover content (always in DOM per Zag dismissable requirements) -->
            <div {...popoverApi.getPositionerProps()}>
              <div class="emoji-popover" {...popoverApi.getContentProps()}>
                <div class="emoji-cat-tabs">
                  {#each EMOJI_CATS as cat (cat.id)}
                    <button
                      class="cat-tab"
                      class:active={activeCat === cat.id}
                      onclick={() => (activeCat = cat.id)}
                      aria-label={cat.id}
                      title={cat.id}
                    >{cat.icon}</button>
                  {/each}
                </div>
                <div class="emoji-grid">
                  {#each EMOJI_CATS.find(c => c.id === activeCat)?.emojis ?? [] as em (em)}
                    <button
                      class="emoji-item"
                      onclick={() => pickEmoji(em)}
                      aria-label={em}
                    >{em}</button>
                  {/each}
                </div>
              </div>
            </div>

            <input
              id="agent-name"
              class="name-input"
              type="text"
              bind:value={name}
              placeholder="my-agent"
              disabled={saving}
              class:field-invalid={!!nameError}
            />
          </div>
          {#if nameError}
            <span class="field-error">{nameError}</span>
          {/if}
        </div>

        <!-- Workspace auto-generated -->
        <div class="form-field full-width">
          <div class="workspace-parts">
            <div class="ws-part">
              <label for="ws-user">User</label>
              <input
                id="ws-user"
                type="text"
                bind:value={hostUser}
                placeholder="minion"
                disabled={saving}
              />
            </div>
            <div class="ws-part">
              <label for="ws-dir">Config dir</label>
              <input
                id="ws-dir"
                type="text"
                bind:value={configDir}
                placeholder=".minion"
                disabled={saving}
              />
            </div>
          </div>
          <span class="field-label">Workspace (auto-generated)</span>
          <div class="workspace-preview">{workspacePath}</div>
        </div>

        <!-- Model combobox (Zag.js fuzzy search) -->
        <div class="form-field full-width">
          <div {...comboboxApi.getRootProps()}>
            <label class="field-label" {...comboboxApi.getLabelProps()}>Model</label>
            <div class="combobox-control" {...comboboxApi.getControlProps()}>
              <input
                class="combobox-input"
                {...comboboxApi.getInputProps()}
                disabled={saving}
              />
              <button
                class="combobox-clear"
                aria-label="Clear model"
                tabindex="-1"
                {...comboboxApi.getClearTriggerProps()}
              >×</button>
              <button
                class="combobox-trigger"
                tabindex="-1"
                aria-label="Toggle model list"
                {...comboboxApi.getTriggerProps()}
              >▾</button>
            </div>
            <!-- Positioner always in DOM — hidden via CSS when closed -->
            <div class="combobox-positioner" {...comboboxApi.getPositionerProps()}>
              <div class="combobox-content" {...comboboxApi.getContentProps()}>
                <ul class="combobox-list" {...comboboxApi.getListProps()}>
                  {#each filteredModels as item (item.id)}
                    <li class="combobox-item" {...comboboxApi.getItemProps({ item })}>
                      <span class="combobox-item-name" {...comboboxApi.getItemTextProps({ item })}>{item.name}</span>
                      {#if item.id === defaultModel}
                        <span class="combobox-item-default">default</span>
                      {/if}
                      <span class="combobox-item-id">{item.id}</span>
                    </li>
                  {/each}
                  {#if filteredModels.length === 0}
                    <li class="combobox-empty">No matches</li>
                  {/if}
                </ul>
              </div>
            </div>
          </div>
        </div>

      </div>

      {#if errorMsg}
        <div class="submit-error">{errorMsg}</div>
      {/if}

      <div class="form-actions">
        <button class="cancel-btn" onclick={close} disabled={saving}>Cancel</button>
        <button class="save-btn" onclick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create Agent'}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  /* ── Overlay / panel ───────────────────────────────────────────── */
  .overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
  }
  .panel {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 12px; width: 480px;
    max-width: calc(100vw - 40px);
    display: flex; flex-direction: column; box-shadow: var(--shadow);
  }
  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .panel-title { font-size: 16px; font-weight: 700; }
  .close-btn {
    background: none; border: none; color: var(--text3);
    cursor: pointer; font-size: 20px; line-height: 1;
    padding: 2px 6px; border-radius: 4px; transition: color 0.2s;
  }
  .close-btn:hover { color: var(--text); }
  .panel-body { padding: 16px 20px 20px; }

  /* ── Form layout ───────────────────────────────────────────────── */
  .form-fields {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 10px; margin-bottom: 12px;
  }
  .form-field { display: flex; flex-direction: column; gap: 4px; }
  .form-field.full-width { grid-column: 1 / -1; }
  .form-field > label,
  .form-field label,
  .field-label { font-size: 11px; color: var(--text3); }
  .form-field input {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 5px;
    color: var(--text); padding: 5px 9px; font-family: inherit; font-size: 13px;
    outline: none; transition: border-color 0.2s;
  }
  .form-field input:focus { border-color: var(--accent); }
  .form-field input:disabled { opacity: 0.5; cursor: not-allowed; }
  .form-field input.field-invalid { border-color: var(--red, #ef4444); }
  .field-error { font-size: 10px; color: var(--red, #ef4444); margin-top: 1px; }

  /* ── Name row ──────────────────────────────────────────────────── */
  .name-row {
    display: flex; gap: 8px; align-items: center;
    position: relative;
  }

  /* ── Name input ─────────────────────────────────────────────────── */
  .name-input {
    flex: 1;
    height: 34px; box-sizing: border-box;
    background: var(--bg3); border: 1px solid var(--border); border-radius: 5px;
    color: var(--text); padding: 0 12px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 15px; font-weight: 500;
    outline: none; transition: border-color 0.2s, box-shadow 0.2s;
  }
  .name-input::placeholder { color: var(--text3); font-weight: 400; }
  .name-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .name-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .name-input.field-invalid { border-color: var(--red, #ef4444); }

  /* ── Emoji button ──────────────────────────────────────────────── */
  .emoji-btn {
    width: 34px; height: 34px; flex-shrink: 0; aspect-ratio: 1;
    background: var(--bg3); border: 1px solid var(--border); border-radius: 5px;
    font-size: 15px; cursor: pointer; display: flex;
    align-items: center; justify-content: center;
    transition: border-color 0.2s;
  }
  .emoji-btn:hover:not(:disabled) { border-color: var(--accent); }
  .emoji-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Emoji popover ─────────────────────────────────────────────── */
  .emoji-popover {
    position: absolute; z-index: 2000;
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px; box-shadow: var(--shadow);
    width: 220px;
  }
  .emoji-cat-tabs {
    display: flex; gap: 2px; margin-bottom: 6px;
    border-bottom: 1px solid var(--border); padding-bottom: 4px;
  }
  .cat-tab {
    background: none; border: none; cursor: pointer; font-size: 16px;
    padding: 2px 4px; border-radius: 4px; opacity: 0.5;
    transition: opacity 0.15s, background 0.15s;
  }
  .cat-tab:hover { opacity: 0.8; background: var(--bg3); }
  .cat-tab.active { opacity: 1; background: var(--bg3); }
  .emoji-grid {
    display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px;
  }
  .emoji-item {
    background: none; border: none; cursor: pointer; font-size: 18px;
    padding: 3px; border-radius: 4px; line-height: 1;
    transition: background 0.12s;
  }
  .emoji-item:hover { background: var(--bg3); }

  /* ── Workspace ─────────────────────────────────────────────────── */
  .workspace-preview {
    font-family: monospace; font-size: 12px; color: var(--text2);
    background: var(--bg3); border: 1px solid var(--border);
    border-radius: 5px; padding: 6px 10px; word-break: break-all;
  }
  .workspace-parts {
    display: flex; gap: 8px; margin-top: 4px;
  }
  .ws-part {
    display: flex; flex-direction: column; gap: 3px; flex: 1;
  }
  .ws-part > label {
    font-size: 10px; color: var(--text3);
  }
  .ws-part input {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 5px;
    color: var(--text); padding: 4px 7px; font-family: inherit; font-size: 12px;
    outline: none; transition: border-color 0.2s;
  }
  .ws-part input:focus { border-color: var(--accent); }
  .ws-part input:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Model combobox (Zag.js) ───────────────────────────────────── */
  .combobox-control {
    display: flex; align-items: center;
    background: var(--bg3); border: 1px solid var(--border); border-radius: 5px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .combobox-control:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .combobox-input {
    flex: 1; min-width: 0; background: none; border: none; outline: none;
    color: var(--text); padding: 5px 9px; font-family: inherit; font-size: 13px;
  }
  /* Placeholder is muted; actual selected value uses full --text color */
  .combobox-input::placeholder { color: var(--text3); }
  .combobox-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .combobox-clear {
    background: none; border: none; color: var(--text3); cursor: pointer;
    font-size: 14px; padding: 0 4px; line-height: 1; flex-shrink: 0;
    transition: color 0.15s;
  }
  .combobox-clear:hover { color: var(--text); }
  /* Zag hides clear trigger via data-state when no value */
  .combobox-clear[data-state="hidden"] { display: none; }
  .combobox-trigger {
    background: none; border: none; color: var(--text3); cursor: pointer;
    font-size: 10px; padding: 0 9px 0 2px; line-height: 1; flex-shrink: 0;
    transition: color 0.15s;
  }
  .combobox-trigger:hover { color: var(--text2); }
  /* Positioner: always in DOM, hidden when closed */
  .combobox-positioner { z-index: 2000; }
  .combobox-positioner[data-state="closed"] { display: none; }
  .combobox-content {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 6px; box-shadow: var(--shadow); overflow: hidden;
    min-width: 200px;
  }
  /* Also handle hidden attribute Zag may set */
  .combobox-content[hidden] { display: none; }
  .combobox-list {
    list-style: none; margin: 0; padding: 4px;
    max-height: 200px; overflow-y: auto;
  }
  .combobox-item {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;
    transition: background 0.1s;
  }
  /* Zag sets data-highlighted when item is keyboard/pointer focused */
  .combobox-item[data-highlighted] { background: var(--bg3); }
  /* Zag sets data-selected when item matches current value */
  .combobox-item[data-selected] .combobox-item-name {
    color: var(--accent); font-weight: 600;
  }
  .combobox-item-name {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .combobox-item-id { color: var(--text3); font-size: 11px; font-family: monospace; flex-shrink: 0; }
  .combobox-item-default {
    font-size: 10px; color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-radius: 3px; padding: 1px 5px; flex-shrink: 0;
  }
  .combobox-empty {
    padding: 8px; color: var(--text3); font-size: 12px; font-style: italic;
  }

  /* ── Actions ───────────────────────────────────────────────────── */
  .submit-error {
    background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
    border-radius: 6px; color: var(--red, #ef4444);
    font-size: 12px; padding: 8px 12px; margin-bottom: 12px;
  }
  .form-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .save-btn {
    background: var(--accent); border: none; border-radius: 5px;
    color: #fff; cursor: pointer; font-family: inherit; font-size: 12px;
    font-weight: 600; padding: 6px 16px; transition: filter 0.2s;
  }
  .save-btn:hover:not(:disabled) { filter: brightness(1.15); }
  .save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .cancel-btn {
    background: none; border: 1px solid var(--border); border-radius: 5px;
    color: var(--text3); cursor: pointer; font-family: inherit;
    font-size: 12px; padding: 6px 12px; transition: color 0.2s;
  }
  .cancel-btn:hover:not(:disabled) { color: var(--text2); }
  .cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
