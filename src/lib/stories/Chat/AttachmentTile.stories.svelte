<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { iconSizes } from '$lib/components/ui';
  import { fn } from 'storybook/test';
  import { Download, Trash2 } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';
  import AttachmentTile from '$lib/components/attachments/AttachmentTile.svelte';

  // An inline SVG stands in for the presigned image URL.
  const svg = (hue) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="hsl(${hue} 60% 55%)"/><circle cx="160" cy="120" r="70" fill="hsl(${hue} 60% 85%)"/></svg>`)}`;
  const files = [
    {
      name: 'before-session.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 3_145_728,
      thumb: () => svg(210),
    },
    { name: 'consent-form-signed.pdf', contentType: 'application/pdf', sizeBytes: 184_320 },
    { name: 'voice-note-2026-11-08.m4a', contentType: 'audio/mp4', sizeBytes: 1_024_000 },
    { name: 'procedure-clip.mp4', contentType: 'video/mp4', sizeBytes: 48_234_496 },
    {
      name: 'price-list-2026.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 22_118,
    },
    {
      name: 'referral-letter.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 40_960,
    },
    { name: 'archive.bin', contentType: 'application/octet-stream', sizeBytes: 9_999_999_999 },
    { name: 'after.png', contentType: 'image/png', sizeBytes: 812_000, thumb: () => svg(120) },
  ];

  const { Story } = defineMeta({
    title: 'Chat/AttachmentTile',
    component: AttachmentTile,
    tags: ['autodocs'],
    argTypes: {
      preview: { control: 'select', options: ['off', 'hover', 'card'] },
      muted: { control: 'boolean' },
    },
    args: { ...files[0], meta: 'uploaded 2 h ago', preview: 'hover', onopen: fn() },
  });
</script>

{#snippet rowActions()}
  <Button variant="ghost" size="xs" aria-label="Download" onclick={fn()}
    ><Download size={iconSizes.sm} /></Button
  >
  <Button variant="ghost" size="xs" aria-label="Delete" onclick={fn()}
    ><Trash2 size={iconSizes.sm} /></Button
  >
{/snippet}

<Story name="Image hover preview" />
<Story name="Image card" args={{ preview: 'card' }} />
<Story name="Image off icon only" args={{ preview: 'off' }} />
<Story
  name="Image thumb fails falls back to icon"
  args={{ thumb: () => Promise.reject(new Error('403')) }}
/>
<Story name="PDF" args={files[1]} />
<Story name="Audio" args={files[2]} />
<Story name="Video" args={files[3]} />
<Story name="Spreadsheet" args={files[4]} />
<Story name="Word document" args={files[5]} />
<Story name="Unknown type huge size" args={files[6]} />
<Story
  name="Uploading pending meta"
  args={{ ...files[1], meta: 'uploading… 64 %', onopen: undefined }}
/>
<Story
  name="Failed meta"
  args={{ ...files[1], meta: 'upload failed — file too large', muted: true, onopen: undefined }}
/>
<Story name="Trashed muted" args={{ ...files[1], meta: 'deleted 3 days ago', muted: true }} />
<Story
  name="No extension no meta"
  args={{ name: 'README', contentType: 'text/plain', sizeBytes: 512, meta: undefined }}
/>
<Story
  name="Long file name"
  args={{
    ...files[1],
    name: 'consentimiento-informado-tratamiento-facial-firmado-por-la-paciente-el-08-de-noviembre-de-2026-version-final-revisada.pdf',
  }}
/>

<Story name="With actions and children">
  {#snippet template(args)}
    <AttachmentTile {...args} actions={rowActions}>
      <span class="chip">also on booking BK-204</span>
    </AttachmentTile>
  {/snippet}
</Story>

<Story name="Many list">
  {#snippet template(args)}
    <div class="flex w-full max-w-xl flex-col gap-1">
      {#each files as f (f.name)}<AttachmentTile {...args} {...f} actions={rowActions} />{/each}
    </div>
  {/snippet}
</Story>

<Story name="Many card grid" args={{ preview: 'card' }}>
  {#snippet template(args)}
    <div class="grid w-full max-w-2xl grid-cols-4 gap-2">
      {#each files as f (f.name)}<AttachmentTile {...args} {...f} actions={rowActions} />{/each}
    </div>
  {/snippet}
</Story>

<Story
  name="Many card grid · Phone"
  args={{ preview: 'card' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}
    <div class="grid w-full grid-cols-2 gap-2">
      {#each files as f (f.name)}<AttachmentTile {...args} {...f} actions={rowActions} />{/each}
    </div>
  {/snippet}
</Story>
