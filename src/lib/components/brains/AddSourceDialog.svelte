<script lang="ts">
  import { Carta, MarkdownEditor } from 'carta-md';
  import 'carta-md/default.css';
  import DOMPurify from 'dompurify';
  import { invalidate } from '$app/navigation';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { Button } from '$lib/components/ui';
  import { ChevronLeft, PenLine, Link2, Upload, Blocks, HardDrive, Cloud } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { open = $bindable(false), brainId }: { open?: boolean; brainId: string } = $props();

  type Step = 'pick' | 'note' | 'url' | 'upload' | 'app';
  let step = $state<Step>('pick');

  const carta = new Carta({ sanitizer: (html) => DOMPurify.sanitize(html) });

  // note
  let noteTitle = $state('');
  let noteContent = $state('');
  // url
  let urlTitle = $state('');
  let urlValue = $state('');
  // upload
  let uploadTitle = $state('');
  let uploadFileName = $state('');
  let uploadContent = $state('');
  let uploadError = $state('');
  // connect app data
  let moduleSources = $state<{ key: string; labelKey: string; descriptionKey: string }[]>([]);
  let loadingSources = $state(false);

  let error = $state('');
  let saving = $state(false);

  const UPLOAD_MAX_BYTES = 1_000_000;
  const UPLOAD_EXT = /\.(md|txt|csv)$/i;

  // Server code never calls m.*() (brains.service.ts has no locale context) —
  // `labelKey`/`descriptionKey` from the API are message KEY NAMES, resolved
  // here the same way BrainDocumentsTable maps status/source strings to `m.*`.
  const MODULE_SOURCE_LABELS: Record<string, { label: () => string; desc: () => string }> = {
    fin_products: {
      label: m.brains_source_module_fin_products_label,
      desc: m.brains_source_module_fin_products_desc,
    },
    crm_contacts: {
      label: m.brains_source_module_crm_contacts_label,
      desc: m.brains_source_module_crm_contacts_desc,
    },
    stk_items: {
      label: m.brains_source_module_stk_items_label,
      desc: m.brains_source_module_stk_items_desc,
    },
  };

  const canSubmitNote = $derived(noteTitle.trim().length > 0 && noteContent.trim().length > 0);
  const canSubmitUrl = $derived(urlTitle.trim().length > 0 && urlValue.trim().length > 0);
  const canSubmitUpload = $derived(uploadFileName.length > 0 && uploadContent.trim().length > 0 && !uploadError);

  function reset() {
    step = 'pick';
    noteTitle = '';
    noteContent = '';
    urlTitle = '';
    urlValue = '';
    uploadTitle = '';
    uploadFileName = '';
    uploadContent = '';
    uploadError = '';
    error = '';
  }

  async function postDocument(body: Record<string, unknown>): Promise<boolean> {
    saving = true;
    error = '';
    try {
      const res = await fetch(`/api/brains/${encodeURIComponent(brainId)}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const failBody = await res.json().catch(() => ({}));
        error = (failBody as { message?: string }).message ?? `Error ${res.status}`;
        return false;
      }
      await invalidate('brains:detail');
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
      return false;
    } finally {
      saving = false;
    }
  }

  async function submitNote() {
    if (!canSubmitNote || saving) return;
    if (await postDocument({ title: noteTitle.trim(), sourceType: 'note', contentMd: noteContent })) {
      open = false;
      reset();
    }
  }

  async function submitUrl() {
    if (!canSubmitUrl || saving) return;
    if (await postDocument({ title: urlTitle.trim(), sourceType: 'url', sourceRef: urlValue.trim() })) {
      open = false;
      reset();
    }
  }

  async function submitUpload() {
    if (!canSubmitUpload || saving) return;
    const title = uploadTitle.trim() || uploadFileName;
    if (
      await postDocument({ title, sourceType: 'upload', sourceRef: uploadFileName, contentMd: uploadContent })
    ) {
      open = false;
      reset();
    }
  }

  async function submitModuleSource(key: string, label: string) {
    if (saving) return;
    if (await postDocument({ title: label, sourceType: 'module_ref', sourceRef: key })) {
      open = false;
      reset();
    }
  }

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    uploadError = '';
    uploadFileName = '';
    uploadContent = '';
    if (!file) return;
    if (!UPLOAD_EXT.test(file.name)) {
      uploadError = m.brains_upload_bad_type();
      input.value = '';
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      uploadError = m.brains_upload_too_big();
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      uploadContent = String(reader.result ?? '');
      uploadFileName = file.name;
      if (!uploadTitle.trim()) uploadTitle = file.name;
    };
    reader.readAsText(file);
  }

  async function openAppData() {
    step = 'app';
    if (moduleSources.length > 0 || loadingSources) return;
    loadingSources = true;
    try {
      const res = await fetch('/api/brains/module-sources');
      if (res.ok) moduleSources = ((await res.json()) as { sources: typeof moduleSources }).sources ?? [];
    } finally {
      loadingSources = false;
    }
  }
</script>

<Modal bind:open title={m.brains_source_dialog_title()} onclose={reset} size={step === 'note' ? 'lg' : 'md'}>
  {#snippet header()}
    <div class="flex items-center gap-2">
      {#if step !== 'pick'}
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded-md text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
          aria-label={m.common_back()}
          onclick={() => (step = 'pick')}
        >
          <ChevronLeft size={16} />
        </button>
      {/if}
      <h2 class="t-heading truncate">{m.brains_source_dialog_title()}</h2>
    </div>
  {/snippet}

  {#if step === 'pick'}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button type="button" class="source-card" onclick={() => (step = 'note')}>
        <PenLine size={20} />
        <span class="source-card-title">{m.brains_source_pick_note_title()}</span>
        <span class="source-card-desc">{m.brains_source_pick_note_desc()}</span>
      </button>
      <button type="button" class="source-card" onclick={() => (step = 'url')}>
        <Link2 size={20} />
        <span class="source-card-title">{m.brains_source_pick_link_title()}</span>
        <span class="source-card-desc">{m.brains_source_pick_link_desc()}</span>
      </button>
      <button type="button" class="source-card" onclick={() => (step = 'upload')}>
        <Upload size={20} />
        <span class="source-card-title">{m.brains_source_pick_upload_title()}</span>
        <span class="source-card-desc">{m.brains_source_pick_upload_desc()}</span>
      </button>
      <button type="button" class="source-card" onclick={openAppData}>
        <Blocks size={20} />
        <span class="source-card-title">{m.brains_source_pick_app_title()}</span>
        <span class="source-card-desc">{m.brains_source_pick_app_desc()}</span>
      </button>
      <button type="button" class="source-card source-card-disabled" disabled>
        <HardDrive size={20} />
        <span class="source-card-title">{m.brains_source_pick_drive_title()}</span>
        <span class="source-card-desc">{m.brains_source_coming_soon()}</span>
      </button>
      <button type="button" class="source-card source-card-disabled" disabled>
        <Cloud size={20} />
        <span class="source-card-title">{m.brains_source_pick_s3_title()}</span>
        <span class="source-card-desc">{m.brains_source_coming_soon()}</span>
      </button>
    </div>
  {:else if step === 'note'}
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="source-note-title">{m.brains_note_name()}</label>
        <input
          id="source-note-title"
          type="text"
          bind:value={noteTitle}
          placeholder={m.brains_note_name_ph()}
          autocomplete="off"
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-white/70">{m.brains_note_content()}</span>
        <div class="note-carta h-64 overflow-hidden rounded-lg border border-white/10">
          <MarkdownEditor {carta} bind:value={noteContent} mode="tabs" theme="dark" placeholder={m.brains_note_content()} />
        </div>
      </div>
      {#if error}<p class="text-xs text-red-400">{error}</p>{/if}
    </div>
  {:else if step === 'url'}
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="source-url-title">{m.brains_url_name()}</label>
        <input
          id="source-url-title"
          type="text"
          bind:value={urlTitle}
          placeholder={m.brains_url_name_ph()}
          autocomplete="off"
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="source-url-ref">{m.brains_url_ref()}</label>
        <input
          id="source-url-ref"
          type="url"
          bind:value={urlValue}
          placeholder={m.brains_url_ref_ph()}
          autocomplete="off"
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
        />
      </div>
      {#if error}<p class="text-xs text-red-400">{error}</p>{/if}
    </div>
  {:else if step === 'upload'}
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="source-upload-title">{m.common_title()}</label>
        <input
          id="source-upload-title"
          type="text"
          bind:value={uploadTitle}
          autocomplete="off"
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="source-upload-file">{m.brains_upload_file_label()}</label>
        <input
          id="source-upload-file"
          type="file"
          accept=".md,.txt,.csv"
          onchange={onFileChange}
          class="text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-1.5 file:text-xs file:text-white"
        />
        <p class="text-[11px] text-white/40">{m.brains_upload_hint()}</p>
        {#if uploadFileName}<p class="text-xs text-white/60">{uploadFileName}</p>{/if}
      </div>
      {#if uploadError}<p class="text-xs text-red-400">{uploadError}</p>{/if}
      {#if error}<p class="text-xs text-red-400">{error}</p>{/if}
    </div>
  {:else if step === 'app'}
    <div class="flex flex-col gap-2">
      {#if loadingSources}
        <p class="text-sm text-white/50">{m.common_loading()}</p>
      {:else if moduleSources.length === 0}
        <p class="text-sm text-white/50">{m.brains_source_app_empty()}</p>
      {:else}
        {#each moduleSources as src (src.key)}
          {@const labels = MODULE_SOURCE_LABELS[src.key]}
          <button
            type="button"
            class="source-card source-card-row"
            disabled={saving}
            onclick={() => submitModuleSource(src.key, labels?.label() ?? src.key)}
          >
            <span class="source-card-title">{labels?.label() ?? src.key}</span>
            <span class="source-card-desc">{labels?.desc() ?? ''}</span>
          </button>
        {/each}
      {/if}
      {#if error}<p class="text-xs text-red-400">{error}</p>{/if}
    </div>
  {/if}

  {#snippet footer()}
    {#if step === 'note'}
      <Button variant="primary" size="sm" disabled={!canSubmitNote || saving} loading={saving} onclick={submitNote}>
        {m.brains_note_submit()}
      </Button>
    {:else if step === 'url'}
      <Button variant="primary" size="sm" disabled={!canSubmitUrl || saving} loading={saving} onclick={submitUrl}>
        {m.brains_url_submit()}
      </Button>
    {:else if step === 'upload'}
      <Button
        variant="primary"
        size="sm"
        disabled={!canSubmitUpload || saving}
        loading={saving}
        onclick={submitUpload}
      >
        {m.brains_upload_submit()}
      </Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .source-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.375rem;
    padding: 0.875rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: white;
    text-align: left;
    transition:
      background-color 150ms,
      border-color 150ms;
  }
  .source-card:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(255, 255, 255, 0.2);
  }
  .source-card:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .source-card-title {
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .source-card-desc {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }
  .source-card-row {
    width: 100%;
  }
  .note-carta :global(.carta-theme__dark.carta-editor) {
    height: 100%;
    border: none;
    border-radius: 0;
  }
  .note-carta :global(.carta-container) {
    height: 100%;
  }
  .note-carta :global(.carta-input),
  .note-carta :global(.carta-renderer) {
    height: 100%;
    overflow-y: auto;
  }
</style>
