<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { Plus, RotateCw, Trash2 } from 'lucide-svelte';
  import { Button, Badge, EmptyState } from '$lib/components/ui';
  import type { SemanticValue } from '@minion-stack/ui';
  import * as m from '$lib/paraglide/messages';
  import { relativeTime } from '$lib/components/crm/crm-format';
  import type { BrainDocumentDTO } from '$lib/types/brains';
  import AddSourceDialog from './AddSourceDialog.svelte';

  let { brainId, documents, canEdit }: { brainId: string; documents: BrainDocumentDTO[]; canEdit: boolean } = $props();

  let showAddSource = $state(false);
  let busyId = $state<string | null>(null);

  // `doc.status`/`doc.sourceType` are plain `string` columns (see
  // $lib/types/brains.ts) — these lookups fall back gracefully for any value
  // outside the known set rather than requiring an exhaustive cast.
  const STATUS_VALUE: Record<string, SemanticValue> = {
    pending: 'warning',
    ingesting: 'info',
    ready: 'success',
    failed: 'error',
  };
  const STATUS_LABEL: Record<string, () => string> = {
    pending: m.brains_status_pending,
    ingesting: m.brains_status_ingesting,
    ready: m.brains_status_ready,
    failed: m.brains_status_failed,
  };
  const SOURCE_LABEL: Record<string, () => string> = {
    note: m.brains_source_note,
    url: m.brains_source_url,
    upload: m.brains_source_upload,
    module_ref: m.brains_source_module_ref,
  };

  async function reingest(docId: string) {
    busyId = docId;
    try {
      await fetch(`/api/brains/${encodeURIComponent(brainId)}/documents/${encodeURIComponent(docId)}/reingest`, {
        method: 'POST',
      });
      await invalidate('brains:detail');
    } finally {
      busyId = null;
    }
  }

  async function remove(docId: string) {
    if (!confirm(m.brains_delete_confirm())) return;
    busyId = docId;
    try {
      await fetch(`/api/brains/${encodeURIComponent(brainId)}/documents/${encodeURIComponent(docId)}`, {
        method: 'DELETE',
      });
      await invalidate('brains:detail');
    } finally {
      busyId = null;
    }
  }
</script>

{#if canEdit}
  <div class="mb-3 flex items-center justify-end gap-2">
    <Button variant="secondary" size="sm" onclick={() => (showAddSource = true)}>
      {#snippet icon()}<Plus size={14} />{/snippet}
      {m.brains_source_add()}
    </Button>
  </div>
{/if}

{#if documents.length === 0}
  <EmptyState title={m.brains_doc_empty()} compact />
{:else}
  <div class="overflow-x-auto rounded-xl border border-white/10">
    <table class="w-full text-left text-sm">
      <thead>
        <tr class="border-b border-white/10 text-[11px] uppercase tracking-wide text-white/40">
          <th class="px-3 py-2 font-medium">{m.brains_doc_title()}</th>
          <th class="px-3 py-2 font-medium">{m.brains_doc_source()}</th>
          <th class="px-3 py-2 font-medium">{m.brains_doc_status()}</th>
          <th class="px-3 py-2 font-medium">{m.brains_doc_updated()}</th>
          {#if canEdit}<th class="px-3 py-2 font-medium">{m.brains_doc_actions()}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each documents as doc (doc.id)}
          <tr class="border-b border-white/5 last:border-0">
            <td class="max-w-xs truncate px-3 py-2 text-white/90">
              {doc.title}
              {#if doc.status === 'failed' && doc.error}
                <p class="truncate text-[11px] text-red-400/80" title={doc.error}>{doc.error}</p>
              {/if}
            </td>
            <td class="px-3 py-2">
              <Badge variant="neutral" size="sm">{SOURCE_LABEL[doc.sourceType]?.() ?? doc.sourceType}</Badge>
            </td>
            <td class="px-3 py-2">
              <span title={doc.status}>
                <Badge
                  variant="semantic"
                  value={STATUS_VALUE[doc.status] ?? 'warning'}
                  size="sm"
                  dot
                  pulse={doc.status === 'ingesting'}
                >
                  {STATUS_LABEL[doc.status]?.() ?? doc.status}
                </Badge>
              </span>
            </td>
            <td class="px-3 py-2 text-white/50">{relativeTime(doc.updatedAt)}</td>
            {#if canEdit}
              <td class="px-3 py-2">
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="grid size-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                    aria-label={m.brains_doc_reingest()}
                    title={m.brains_doc_reingest()}
                    disabled={busyId === doc.id}
                    onclick={() => reingest(doc.id)}
                  >
                    <RotateCw size={14} />
                  </button>
                  <button
                    type="button"
                    class="grid size-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                    aria-label={m.brains_doc_delete()}
                    title={m.brains_doc_delete()}
                    disabled={busyId === doc.id}
                    onclick={() => remove(doc.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<AddSourceDialog bind:open={showAddSource} {brainId} />
