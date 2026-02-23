<script lang="ts">
  import { sendRequest } from '$lib/services/gateway.svelte';

  let { agentId }: { agentId: string } = $props();

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
      // Refresh list in case size/modified changed
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

<div class="flex flex-col h-full overflow-hidden">
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
            class="text-[11px] font-semibold px-2 py-1 rounded bg-primary text-white disabled:opacity-50"
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
    <div class="flex-1 overflow-auto p-3">
      {#if fileLoading}
        <p class="text-muted text-xs text-center mt-8">Loading...</p>
      {:else if editing}
        <textarea
          class="w-full h-full bg-bg1 text-foreground text-xs font-mono p-2 border border-border rounded resize-none"
          bind:value={editContent}
        ></textarea>
      {:else}
        <pre class="text-xs font-mono whitespace-pre-wrap text-foreground">{fileContent}</pre>
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
