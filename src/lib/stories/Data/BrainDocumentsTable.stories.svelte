<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import BrainDocumentsTable from '$lib/components/brains/BrainDocumentsTable.svelte';
  import type { BrainDocumentDTO } from '$lib/types/brains';

  const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
  function doc(i: number, over: Partial<BrainDocumentDTO> = {}): BrainDocumentDTO {
    return {
      id: `doc-${i}`,
      brainId: 'brain-1',
      orgId: 'org-1',
      title: ['Onboarding checklist', 'Refund policy', 'Price list 2026 (all branches, including seasonal services and packages)', 'FAQ'][i % 4],
      sourceType: ['note', 'url', 'upload', 'module_ref'][i % 4],
      sourceRef: i % 4 === 1 ? 'https://example.com/policies/refunds' : null,
      contentMd: i % 4 === 0 ? '# Checklist\n- step one' : null,
      status: ['ready', 'ingesting', 'pending', 'failed'][i % 4],
      error: i % 4 === 3 ? 'Fetch failed: 404 Not Found' : null,
      createdBy: 'user-1',
      createdAt: new Date(NOW - (i + 1) * 86_400_000),
      updatedAt: new Date(NOW - i * 3_600_000),
      ...over,
    };
  }
  const documents = Array.from({ length: 8 }, (_, i) => doc(i));

  const { Story } = defineMeta({
    title: 'Components/Data/BrainDocumentsTable',
    component: BrainDocumentsTable,
    tags: ['autodocs'],
    argTypes: { canEdit: { control: 'boolean' } },
    args: { brainId: 'brain-1', documents, canEdit: true },
  });
</script>

<Story name="Populated">
  {#snippet template(args)}
    <BrainDocumentsTable {...args} />
  {/snippet}
</Story>

<Story name="ReadOnly" args={{ canEdit: false }}>
  {#snippet template(args)}
    <BrainDocumentsTable {...args} />
  {/snippet}
</Story>

<Story name="Empty" args={{ documents: [] }}>
  {#snippet template(args)}
    <BrainDocumentsTable {...args} />
  {/snippet}
</Story>

<Story name="EmptyReadOnly" args={{ documents: [], canEdit: false }}>
  {#snippet template(args)}
    <BrainDocumentsTable {...args} />
  {/snippet}
</Story>

<Story name="AllFailed" args={{ documents: documents.map((d, i) => doc(i, { status: 'failed', error: 'Embedding provider returned 429 Too Many Requests' })) }}>
  {#snippet template(args)}
    <BrainDocumentsTable {...args} />
  {/snippet}
</Story>

<Story name="ManyRows" args={{ documents: Array.from({ length: 150 }, (_, i) => doc(i)) }}>
  {#snippet template(args)}
    <BrainDocumentsTable {...args} />
  {/snippet}
</Story>
