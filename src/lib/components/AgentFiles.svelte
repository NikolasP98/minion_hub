<script lang="ts">
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Carta, Markdown, MarkdownEditor } from 'carta-md';
  import 'carta-md/default.css';
  import * as tree from '@zag-js/tree-view';
  import { useMachine, normalizeProps } from '@zag-js/svelte';

  let { agentId }: { agentId: string } = $props();

  const carta = new Carta({ sanitizer: false });

  // ─── FileNode type ────────────────────────────────────────────────────────
  interface FileNode {
    id: string;        // full path e.g. "docs" or "docs/arch.md"
    name: string;      // display name only
    isDir: boolean;
    children?: FileNode[];  // undefined = leaf; [] = branch (dir, possibly unloaded)
    loaded: boolean;        // false = dir contents not yet fetched
    loading: boolean;       // true while fetch in-flight
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }

  // ─── Tree state ───────────────────────────────────────────────────────────
  let treeRootNode = $state<FileNode>({
    id: 'ROOT',
    name: '',
    isDir: true,
    children: [],
    loaded: false,
    loading: false,
    missing: false,
  });

  let error = $state<string | null>(null);

  // ─── File view state ─────────────────────────────────────────────────────
  let selectedFile = $state<string | null>(null);
  let fileContent = $state('');
  let fileLoading = $state(false);

  // ─── Edit state ──────────────────────────────────────────────────────────
  let editing = $state(false);
  let editContent = $state('');
  let saving = $state(false);

  // ─── Derived basename for header display ─────────────────────────────────
  const selectedFileName = $derived(selectedFile?.split('/').pop() ?? null);

  // ─── Zag tree-view ───────────────────────────────────────────────────────
  const treeCollection = $derived(
    tree.collection<FileNode>({
      nodeToValue: (n) => n.id,
      nodeToString: (n) => n.name,
      // Returning a number (even 0) for dirs makes isBranchNode return true
      nodeToChildrenCount: (n) => (n.isDir ? (n.children?.length ?? 0) : undefined),
      rootNode: treeRootNode,
    })
  );

  const treeService = useMachine(tree.machine, () => ({
    id: `files-tree-${agentId}`,
    collection: treeCollection,
    selectionMode: 'single' as const,
    onExpandedChange({ expandedValue }: { expandedValue: string[] }) {
      for (const id of expandedValue) maybeLoadDirectory(id);
    },
    onSelectionChange({ selectedValue }: { selectedValue: string[] }) {
      const path = selectedValue[0];
      const node = path ? findNode(treeRootNode, path) : null;
      if (node && !node.isDir && !node.missing) openFile(path);
    },
  }));

  const api = $derived(tree.connect(treeService, normalizeProps));

  // ─── Tree helpers ─────────────────────────────────────────────────────────
  function findNode(root: FileNode, id: string): FileNode | null {
    if (root.id === id) return root;
    for (const child of root.children ?? []) {
      const found = findNode(child, id);
      if (found) return found;
    }
    return null;
  }

  // ─── Load root files on mount / agentId change ───────────────────────────
  $effect(() => {
    const id = agentId;
    loadRootFiles(id);
  });

  async function loadRootFiles(id: string) {
    treeRootNode.loading = true;
    treeRootNode.loaded = false;
    error = null;
    try {
      const res = (await sendRequest('agents.files.list', { agentId: id })) as {
        files: Array<{ name: string; path: string; isDir?: boolean; missing: boolean; size?: number; updatedAtMs?: number }>;
      };
      treeRootNode.children = (res.files ?? []).map((f) => ({
        id: f.name,
        name: f.name,
        isDir: f.isDir ?? false,
        children: f.isDir ? [] : undefined,
        loaded: !f.isDir,
        loading: false,
        missing: f.missing,
        size: f.size,
        updatedAtMs: f.updatedAtMs,
      }));
      treeRootNode.loaded = true;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Failed to load files';
    } finally {
      treeRootNode.loading = false;
    }
  }

  async function maybeLoadDirectory(id: string) {
    if (id === 'ROOT') return;
    const node = findNode(treeRootNode, id);
    if (!node || !node.isDir || node.loaded || node.loading) return;
    node.loading = true;
    try {
      const res = (await sendRequest('agents.files.list', { agentId, path: id })) as {
        files: Array<{ name: string; path: string; isDir?: boolean; missing: boolean; size?: number; updatedAtMs?: number }>;
      };
      node.children = (res.files ?? []).map((f) => ({
        id: f.name,
        name: f.name,
        isDir: f.isDir ?? false,
        children: f.isDir ? [] : undefined,
        loaded: !f.isDir,
        loading: false,
        missing: f.missing,
        size: f.size,
        updatedAtMs: f.updatedAtMs,
      }));
      node.loaded = true;
    } catch {
      // leave node.loaded = false so user can retry by collapsing + expanding
    } finally {
      node.loading = false;
    }
  }

  async function addFile(path: string) {
    const node = findNode(treeRootNode, path);
    try {
      await sendRequest('agents.files.set', { agentId, name: path, content: '' });
      if (node) {
        node.missing = false;
        node.size = 0;
        node.updatedAtMs = Date.now();
      }
      openFile(path);
    } catch {
      // silently fail; keep missing state
    }
  }

  // ─── File view ────────────────────────────────────────────────────────────
  async function openFile(name: string) {
    selectedFile = name;
    fileLoading = true;
    editing = false;
    try {
      const res = (await sendRequest('agents.files.get', { agentId, name })) as {
        file: { name: string; missing: boolean; content?: string };
      };
      fileContent = res.file?.content ?? '';
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
    editContent = fileContent || '';
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
      loadRootFiles(agentId);
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

  function formatDate(ms?: number): string {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '';
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden agent-files">
  <!-- Header (only when a file is open) -->
  {#if selectedFile}
    <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-bg2">
      <button
        class="text-muted hover:text-foreground transition-colors"
        onclick={backToList}
        aria-label="Back to file list"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span class="text-xs font-semibold text-foreground truncate">{selectedFileName}</span>
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
    </div>
  {/if}

  <!-- Body -->
  {#if selectedFile}
    <!-- File content view -->
    <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
      {#if fileLoading}
        <p class="text-muted text-xs text-center mt-8">Loading...</p>
      {:else if editing}
        <div class="flex-1 min-h-0 carta-wrapper">
          {#key selectedFile}
            <MarkdownEditor
              {carta}
              bind:value={editContent}
              mode="tabs"
              theme="dark"
              placeholder="Write markdown..."
            />
          {/key}
        </div>
      {:else}
        <div class="flex-1 overflow-auto p-3 markdown-view">
          {#key fileContent}
            <Markdown {carta} value={fileContent || ''} theme="dark" />
          {/key}
        </div>
      {/if}
    </div>
  {:else}
    <!-- File tree view -->
    <div class="flex-1 overflow-auto">
      {#if treeRootNode.loading}
        <p class="text-muted text-xs text-center mt-8">Loading files...</p>
      {:else if error}
        <p class="text-red-400 text-xs text-center mt-8">{error}</p>
      {:else if (treeRootNode.children?.length ?? 0) === 0}
        <p class="text-muted text-xs text-center mt-8">No files found.</p>
      {:else}
        <div {...api.getRootProps()}>
          <div {...api.getTreeProps()}>
            {#snippet renderNodes(nodes: FileNode[], parentPath: number[], depth: number)}
              {#each nodes as node, i}
                {@const indexPath = [...parentPath, i]}
                {@const nodeProps = { node, indexPath }}
                {#if node.isDir}
                  {@const isExpanded = api.expandedValue.includes(node.id)}
                  <!-- Directory branch -->
                  <div {...api.getBranchProps(nodeProps)}>
                    <div
                      class="flex items-center gap-1 py-1 pr-2 hover:bg-bg2 cursor-pointer select-none"
                      style:padding-left="{8 + depth * 14}px"
                      {...api.getBranchControlProps(nodeProps)}
                    >
                      <!-- Chevron — programmatically rotated to work correctly at any nesting depth -->
                      <button
                        class="shrink-0 text-muted hover:text-foreground transition-colors w-3 h-3 flex items-center justify-center"
                        tabindex="-1"
                        {...api.getBranchTriggerProps(nodeProps)}
                      >
                        <svg class="w-3 h-3 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                      <!-- Folder icon -->
                      <svg class="w-3 h-3 shrink-0 text-yellow-400/80" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                      </svg>
                      <!-- Name (basename only) -->
                      <span class="text-xs text-foreground truncate flex-1" {...api.getBranchTextProps(nodeProps)}>{node.name.split('/').pop()}</span>
                      <!-- Loading spinner -->
                      {#if node.loading}
                        <svg class="w-3 h-3 shrink-0 text-muted animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                        </svg>
                      {/if}
                    </div>
                    <!-- Children — indented via depth+1 in recursive call -->
                    <div class="tree-branch-content" {...api.getBranchContentProps(nodeProps)}>
                      {#if node.children && node.children.length > 0}
                        {@render renderNodes(node.children, indexPath, depth + 1)}
                      {:else if node.loaded && node.children?.length === 0}
                        <div class="text-[11px] text-muted py-1" style:padding-left="{8 + (depth + 1) * 14}px">
                          Empty directory
                        </div>
                      {/if}
                    </div>
                  </div>
                {:else}
                  <!-- File leaf -->
                  <div
                    class="flex items-center gap-1.5 py-1 pr-2 border-b border-border/30 hover:bg-bg2 cursor-pointer
                      {node.missing ? 'opacity-50' : ''}"
                    style:padding-left="{8 + depth * 14}px"
                    {...api.getItemProps(nodeProps)}
                  >
                    <!-- File icon -->
                    <svg class="w-3 h-3 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                    </svg>
                    <!-- Name (basename only) -->
                    <span class="text-xs text-foreground truncate flex-1" {...api.getItemTextProps(nodeProps)}>{node.name.split('/').pop()}</span>
                    <!-- Metadata or missing + Add button -->
                    {#if node.missing}
                      <span class="text-[11px] text-muted shrink-0">missing</span>
                      <button
                        onclick={(e) => { e.stopPropagation(); addFile(node.id); }}
                        class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent hover:text-white transition-colors shrink-0"
                      >Add</button>
                    {:else}
                      <span class="text-[11px] text-muted min-w-0 truncate ml-1">
                        {formatSize(node.size ?? 0)} &middot; {formatDate(node.updatedAtMs)}
                      </span>
                    {/if}
                  </div>
                {/if}
              {/each}
            {/snippet}
            {@render renderNodes(treeRootNode.children ?? [], [], 0)}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* ─── Hide closed branch content ───────────────────────────────────── */
  .tree-branch-content[data-state='closed'] {
    display: none;
  }

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
    color: var(--color-foreground);
    background: var(--color-bg1);
  }

  .agent-files :global(.carta-theme__dark .carta-input textarea) {
    color: var(--color-foreground);
  }

  /* Shiki highlight overlay — force light text for unhighlighted spans */
  .agent-files :global(.carta-theme__dark .carta-input pre),
  .agent-files :global(.carta-theme__dark .carta-input pre code),
  .agent-files :global(.carta-theme__dark .carta-input pre code .line) {
    color: var(--color-foreground) !important;
  }

  /* Let Shiki's colored tokens keep their colors, but fix the base/fallback */
  .agent-files :global(.carta-theme__dark .shiki),
  .agent-files :global(.carta-theme__dark .shiki code) {
    color: var(--color-foreground) !important;
    background: transparent !important;
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
