<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AttachmentPreviewSwitch from '$lib/components/attachments/AttachmentPreviewSwitch.svelte';
  import AttachmentTile from '$lib/components/attachments/AttachmentTile.svelte';
  import { attachmentPreview } from '$lib/attachments/preview-mode.svelte';

  // No props: it reads and writes the shared `attachmentPreview` mode (localStorage).
  const svg = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="hsl(210 60% 55%)"/></svg>')}`;

  const { Story } = defineMeta({
    title: 'Chat/AttachmentPreviewSwitch',
    component: AttachmentPreviewSwitch,
    tags: ['autodocs'],
  });
</script>

<Story name="Switch" />

<Story name="Driving tiles live mode">
  {#snippet template()}
    <div class="flex w-full max-w-xl flex-col gap-3">
      <AttachmentPreviewSwitch />
      <div class={['flex flex-col gap-1', attachmentPreview.mode === 'card' && 'grid grid-cols-3']}>
        <AttachmentTile
          name="before.jpg"
          contentType="image/jpeg"
          sizeBytes={812_000}
          meta="2 h ago"
          preview={attachmentPreview.mode}
          thumb={() => svg}
        />
        <AttachmentTile
          name="consent.pdf"
          contentType="application/pdf"
          sizeBytes={184_320}
          meta="yesterday"
          preview={attachmentPreview.mode}
        />
        <AttachmentTile
          name="note.m4a"
          contentType="audio/mp4"
          sizeBytes={1_024_000}
          meta="3 days ago"
          preview={attachmentPreview.mode}
        />
      </div>
    </div>
  {/snippet}
</Story>
