<script lang="ts">
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Carta, Markdown, MarkdownEditor } from 'carta-md';
  import 'carta-md/default.css';

  let { agentId }: { agentId: string } = $props();

  const carta = new Carta({ sanitizer: false });

  // ─── List state ──────────────────────────────────────────────────────────
  let files = $state<Array<{ name: string; size: number; modified: string }>>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // ─── File view state ─────────────────────────────────────────────────────
  let selectedFile = $state<string | null>(null);
  let fileContent = $state('');
  let fileLoading = $state(false);

  // ─── Edit state ──────────────────────────────────────────────────────────
  let editing = $state(false);
  let editContent = $state('');
  let saving = $state(false);

  // ─── Fetch file list on mount / agentId change ───────────────────────────
  $effect(() => {
    const id = agentId;
    loadFiles(id);
  });

  async function loadFiles(id: string) {
    loading = true;
    error = null;
    try {
      const res = (await sendRequest('agents.files.list', { agentId: id })) as {
        files: Array<{ name: string; size: number; modified: string }>;
      };
      files = res.files;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Failed to load files';
    } finally {
      loading = false;
    }
  }

  async function openFile(name: string) {
    selectedFile = name;
    fileLoading = true;
    editing = false;
    try {
      const res = (await sendRequest('agents.files.get', { agentId, name })) as {
        content: string;
      };
      fileContent = res.content;
    } catch {
      fileContent = 'Error loading file content.';
    } finally {
      fileLoading = false;
    }
  }

  function backToList() {
    selectedFile = null;
    fileContent = '';
    editing = false;
  }

  function startEdit() {
    editContent = fileContent;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
  }

  async function saveFile() {
    if (!selectedFile) return;
    saving = true;
    try {
      await sendRequest('agents.files.set', {
        agentId,
        name: selectedFile,
        content: editContent,
      });
      fileContent = editContent;
      editing = false;
      loadFiles(agentId);
    } catch {
      // keep edit mode open so user can retry
    } finally {
      saving = false;
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden agent-files">
  <!-- Header -->
  <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-bg2">
    {#if selectedFile}
      <button
        class="text-muted hover:text-foreground transition-colors"
        onclick={backToList}
        aria-label="Back to file list"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span class="text-xs font-semibold text-foreground truncate">{selectedFile}</span>
      <div class="ml-auto flex items-center gap-1">
        {#if editing}
          <button
            class="text-[11px] font-semibold px-2 py-1 rounded bg-accent text-white disabled:opacity-50"
            onclick={saveFile}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            class="text-[11px] font-semibold px-2 py-1 rounded bg-bg1 text-muted hover:text-foreground border border-border"
            onclick={cancelEdit}
          >
            Cancel
          </button>
        {:else}
          <button
            class="text-[11px] font-semibold px-2 py-1 rounded bg-bg1 text-muted hover:text-foreground border border-border"
            onclick={startEdit}
          >
            Edit
          </button>
        {/if}
      </div>
    {:else}
      <span class="text-[11px] font-semibold text-muted uppercase tracking-wide">Files</span>
    {/if}
  </div>

  <!-- Body -->
  {#if selectedFile}
    <!-- File content view -->
    <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
      {#if fileLoading}
        <p class="text-muted text-xs text-center mt-8">Loading...</p>
      {:else if editing}
        <div class="flex-1 min-h-0 carta-wrapper">
          <MarkdownEditor
            {carta}
            bind:value={editContent}
            mode="tabs"
            theme="dark"
            placeholder="Write markdown..."
          />
        </div>
      {:else}
        <div class="flex-1 overflow-auto p-3 markdown-view">
          {#key fileContent}
            <Markdown {carta} value={fileContent} theme="dark" />
          {/key}
        </div>
      {/if}
    </div>
  {:else}
    <!-- File list view -->
    <div class="flex-1 overflow-auto">
      {#if loading}
        <p class="text-muted text-xs text-center mt-8">Loading files...</p>
      {:else if error}
        <p class="text-red-400 text-xs text-center mt-8">{error}</p>
      {:else if files.length === 0}
        <p class="text-muted text-xs text-center mt-8">No files found.</p>
      {:else}
        {#each files as file (file.name)}
          <button
            class="w-full text-left px-3 py-2 hover:bg-bg2 cursor-pointer border-b border-border/50 flex items-center justify-between"
            onclick={() => openFile(file.name)}
          >
            <span class="text-xs text-foreground truncate">{file.name}</span>
            <span class="text-[11px] text-muted shrink-0 ml-2">
              {formatSize(file.size)} &middot; {formatDate(file.modified)}
            </span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* ─── Dark theme for Carta ─────────────────────────────────────────── */
  .agent-files :global(.carta-theme__dark) {
    --border-color: var(--color-border);
    --selection-color: rgba(139, 180, 240, 0.2);
    --focus-outline: var(--color-accent);
    --hover-color: var(--color-bg2);
    --caret-color: var(--color-foreground);
    --text-color: var(--color-foreground);
  }

  .agent-files :global(.carta-theme__dark.carta-editor) {
    border: none;
    border-radius: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .agent-files :global(.carta-theme__dark .carta-toolbar) {
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg2);
    padding: 0 8px;
  }

  .agent-files :global(.carta-theme__dark .carta-toolbar-left button) {
    color: var(--color-muted);
    font-size: 11px;
    font-weight: 600;
    padding: 6px 8px 4px;
    border-bottom: 2px solid transparent;
    margin-right: 8px;
  }

  .agent-files :global(.carta-theme__dark .carta-toolbar-left button.carta-active) {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }

  .agent-files :global(.carta-theme__dark .carta-toolbar-left button:hover) {
    color: var(--color-foreground);
  }

  .agent-files :global(.carta-theme__dark button) {
    color: var(--color-muted);
  }

  .agent-files :global(.carta-theme__dark .carta-icon:hover),
  .agent-files :global(.carta-theme__dark .carta-icon-full:hover) {
    background: var(--color-bg1);
  }

  .agent-files :global(.carta-theme__dark .carta-wrapper) {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0;
  }

  .agent-files :global(.carta-theme__dark .carta-container) {
    height: 100%;
  }

  .agent-files :global(.carta-theme__dark .carta-container > *) {
    margin: 0;
  }

  .agent-files :global(.carta-theme__dark .carta-input),
  .agent-files :global(.carta-theme__dark .carta-renderer) {
    height: 100%;
    overflow-y: auto;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
  }

  .agent-files :global(.carta-theme__dark .carta-input) {
    caret-color: var(--color-foreground);
    background: var(--color-bg1);
  }

  .agent-files :global(.carta-theme__dark .carta-renderer) {
    background: var(--color-bg1);
    color: var(--color-foreground);
  }

  /* ─── Markdown rendered content styling ─────────────────────────── */
  .markdown-view :global(.carta-viewer) {
    border: none;
    border-radius: 0;
  }

  .agent-files :global(.markdown-body),
  .markdown-view :global(.markdown-body) {
    color: var(--color-foreground);
    font-size: 13px;
    line-height: 1.6;
  }

  .agent-files :global(.markdown-body h1),
  .agent-files :global(.markdown-body h2),
  .agent-files :global(.markdown-body h3),
  .agent-files :global(.markdown-body h4) {
    color: var(--color-foreground);
    margin-top: 1.2em;
    margin-bottom: 0.4em;
    font-weight: 600;
  }

  .agent-files :global(.markdown-body h1) { font-size: 1.4em; }
  .agent-files :global(.markdown-body h2) { font-size: 1.2em; }
  .agent-files :global(.markdown-body h3) { font-size: 1.05em; }

  .agent-files :global(.markdown-body p) {
    margin: 0.4em 0;
  }

  .agent-files :global(.markdown-body code) {
    background: var(--color-bg2);
    padding: 2px 5px;
    border-radius: 3px;
    font-size: 0.9em;
  }

  .agent-files :global(.markdown-body pre) {
    background: var(--color-bg2);
    padding: 10px 12px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.6em 0;
  }

  .agent-files :global(.markdown-body pre code) {
    background: none;
    padding: 0;
  }

  .agent-files :global(.markdown-body ul),
  .agent-files :global(.markdown-body ol) {
    padding-left: 1.5em;
    margin: 0.4em 0;
  }

  .agent-files :global(.markdown-body li) {
    margin: 0.15em 0;
  }

  .agent-files :global(.markdown-body blockquote) {
    border-left: 3px solid var(--color-border);
    padding-left: 10px;
    margin: 0.6em 0;
    color: var(--color-muted);
  }

  .agent-files :global(.markdown-body a) {
    color: var(--color-accent);
  }

  .agent-files :global(.markdown-body hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 1em 0;
  }

  .agent-files :global(.markdown-body table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.6em 0;
  }

  .agent-files :global(.markdown-body th),
  .agent-files :global(.markdown-body td) {
    border: 1px solid var(--color-border);
    padding: 4px 8px;
    text-align: left;
  }

  .agent-files :global(.markdown-body th) {
    background: var(--color-bg2);
    font-weight: 600;
  }

  /* ─── Font for code ─────────────────────────────────────────────── */
  .agent-files :global(.carta-font-code) {
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px;
    line-height: 1.5;
  }

  /* ─── Carta wrapper fill ────────────────────────────────────────── */
  .carta-wrapper {
    display: flex;
    flex-direction: column;
  }
</style>
