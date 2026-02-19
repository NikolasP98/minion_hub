<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import type { Agent } from '$lib/types/gateway';
  import * as popover from '@zag-js/popover';
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
  // In zag-js 1.x, first arg is the machine definition object (not a called function)
  const popoverService = useMachine(popover.machine, () => ({
    id: 'emoji-picker',
    positioning: { placement: 'bottom-start' },
  }));
  const popoverApi = $derived(popover.connect(popoverService, normalizeProps));

  // ── Model combobox (fuzzy search) ─────────────────────────────────────────
  let modelQuery = $state('');
  let modelOpen = $state(false);
  let modelHighlight = $state(0);

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

  const selectedModelItem = $derived(modelItems.find(m => m.id === selectedModel) ?? null);

  function selectModelItem(item: ModelItem) {
    selectedModel = item.id;
    modelQuery = '';
    modelOpen = false;
  }

  function modelInputKeydown(e: KeyboardEvent) {
    if (!modelOpen) { if (e.key === 'ArrowDown' || e.key === 'Enter') { modelOpen = true; modelHighlight = 0; } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); modelHighlight = Math.min(modelHighlight + 1, filteredModels.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); modelHighlight = Math.max(modelHighlight - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filteredModels[modelHighlight]) selectModelItem(filteredModels[modelHighlight]); }
    else if (e.key === 'Escape') { modelOpen = false; modelQuery = ''; }
  }

  // ── Click-outside action ──────────────────────────────────────────────────
  function clickOutside(node: HTMLElement, handler: () => void) {
    function onPointerDown(e: PointerEvent) {
      if (!node.contains(e.target as Node)) handler();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return { destroy() { document.removeEventListener('pointerdown', onPointerDown, true); } };
  }

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
    modelOpen = false;
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

      const res = await sendRequest('agents.create', params) as { agentId?: string; agent?: Agent; id?: string } | null;

      const listRes = await sendRequest('agents.list', {}) as { agents?: Agent[] } | null;
      if (listRes?.agents) gw.agents = listRes.agents;

      const newId = res?.agentId ?? res?.agent?.id ?? res?.id ?? null;
      if (newId) ui.selectedAgentId = newId;

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

            <!-- Popover content -->
            {#if popoverApi.open}
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
            {/if}

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

        <!-- Model combobox (fuzzy search) -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="form-field full-width"
          onmouseleave={() => { if (!modelOpen) modelHighlight = 0; }}
        >
          <label for="model-input">Model</label>
          <div class="combobox-wrap" use:clickOutside={() => { modelOpen = false; modelQuery = ''; }}>
            <div class="combobox-field" class:combobox-open={modelOpen}>
              <input
                id="model-input"
                class="combobox-input"
                type="text"
                autocomplete="off"
                placeholder={selectedModelItem
                  ? selectedModelItem.id === defaultModel
                    ? `${selectedModelItem.name} (default)`
                    : selectedModelItem.name
                  : 'Search models…'}
                bind:value={modelQuery}
                disabled={saving}
                onfocus={() => { modelOpen = true; modelHighlight = 0; }}
                oninput={() => { modelOpen = true; modelHighlight = 0; }}
                onkeydown={modelInputKeydown}
              />
              {#if selectedModel && !modelQuery}
                <button
                  class="combobox-clear"
                  aria-label="Clear model"
                  onclick={() => { selectedModel = ''; modelQuery = ''; }}
                  tabindex="-1"
                >×</button>
              {/if}
              <span class="combobox-chevron" aria-hidden="true">▾</span>
            </div>
            {#if modelOpen}
              <ul class="combobox-list" role="listbox">
                {#each filteredModels as item, i (item.id)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <li
                    class="combobox-item"
                    class:combobox-highlighted={i === modelHighlight}
                    class:combobox-selected={item.id === selectedModel}
                    role="option"
                    aria-selected={item.id === selectedModel}
                    onmousedown={() => selectModelItem(item)}
                    onmouseenter={() => (modelHighlight = i)}
                  >
                    <span class="combobox-item-name">{item.name}</span>
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
            {/if}
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

  /* ── Model combobox ────────────────────────────────────────────── */
  .combobox-wrap { position: relative; }
  .combobox-field {
    display: flex; align-items: center;
    background: var(--bg3); border: 1px solid var(--border); border-radius: 5px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .combobox-field:focus-within,
  .combobox-field.combobox-open {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .combobox-input {
    flex: 1; min-width: 0;
    background: none; border: none; outline: none;
    color: var(--text); padding: 5px 9px; font-family: inherit; font-size: 13px;
  }
  .combobox-input::placeholder { color: var(--text3); }
  .combobox-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .combobox-clear {
    background: none; border: none; color: var(--text3); cursor: pointer;
    font-size: 14px; padding: 0 4px; line-height: 1; flex-shrink: 0;
  }
  .combobox-clear:hover { color: var(--text); }
  .combobox-chevron { font-size: 10px; color: var(--text3); padding-right: 9px; flex-shrink: 0; }
  .combobox-list {
    position: absolute; top: calc(100% + 3px); left: 0; right: 0; z-index: 2000;
    list-style: none; margin: 0; padding: 4px;
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 6px; box-shadow: var(--shadow);
    max-height: 200px; overflow-y: auto;
  }
  .combobox-item {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 8px; border-radius: 4px; font-size: 12px;
    cursor: pointer; transition: background 0.1s;
  }
  .combobox-item:hover,
  .combobox-highlighted { background: var(--bg3); }
  .combobox-selected .combobox-item-name { color: var(--accent); }
  .combobox-item-name { flex: 1; min-width: 0; truncate: ellipsis; }
  .combobox-item-id { color: var(--text3); font-size: 11px; font-family: monospace; flex-shrink: 0; }
  .combobox-item-default {
    font-size: 10px; color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-radius: 3px; padding: 1px 5px; flex-shrink: 0;
  }
  .combobox-empty { padding: 8px; color: var(--text3); font-size: 12px; font-style: italic; }

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
