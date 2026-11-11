<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { iconSizes } from '$lib/components/ui';
  import PageHeader from '$lib/components/ui/PageHeader.svelte';
  import { Button, IconButton } from '@minion-stack/ui';
  import { ArrowLeft, Ellipsis } from 'lucide-svelte';

  const { Story } = defineMeta({
    title: 'Atoms/Layout/PageHeader',
    component: PageHeader,
    tags: ['autodocs'],
    argTypes: { sticky: { control: 'boolean' } },
    args: {
      title: 'Point of Sale',
      subtitle: 'Sell, accounts and catalog in one place',
      sticky: false,
    },
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <PageHeader {...args} />
  {/snippet}
</Story>

<Story name="Primary action">
  {#snippet template(args)}
    <PageHeader {...args}>
      {#snippet primaryActions()}<Button variant="primary">New sale</Button>{/snippet}
    </PageHeader>
  {/snippet}
</Story>

<Story name="Full">
  {#snippet template(args)}
    <PageHeader {...args}>
      {#snippet leading()}
        <IconButton label="Back" variant="ghost"
          >{#snippet icon()}<ArrowLeft size={iconSizes.md} />{/snippet}</IconButton
        >
      {/snippet}
      {#snippet primaryActions()}<Button variant="primary">New sale</Button>{/snippet}
      {#snippet secondaryActions()}<Button variant="secondary">Export</Button>{/snippet}
      {#snippet overflowActions()}
        <IconButton label="More" variant="ghost"
          >{#snippet icon()}<Ellipsis size={iconSizes.md} />{/snippet}</IconButton
        >
      {/snippet}
    </PageHeader>
  {/snippet}
</Story>

<Story name="Title only" args={{ subtitle: undefined }}>
  {#snippet template(args)}
    <PageHeader {...args} />
  {/snippet}
</Story>

<!-- Responsive: actions wrap under the title below 768px; medium (768) and wide (1280) keep them inline. -->
<Story name="Full · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}
    <PageHeader {...args}>
      {#snippet leading()}
        <IconButton label="Back" variant="ghost"
          >{#snippet icon()}<ArrowLeft size={iconSizes.md} />{/snippet}</IconButton
        >
      {/snippet}
      {#snippet primaryActions()}<Button variant="primary">New sale</Button>{/snippet}
      {#snippet secondaryActions()}<Button variant="secondary">Export</Button>{/snippet}
      {#snippet overflowActions()}
        <IconButton label="More" variant="ghost"
          >{#snippet icon()}<Ellipsis size={iconSizes.md} />{/snippet}</IconButton
        >
      {/snippet}
    </PageHeader>
  {/snippet}
</Story>

<Story name="Full · Tablet" globals={{ viewport: { value: 'tablet', isRotated: false } }}>
  {#snippet template(args)}
    <PageHeader {...args}>
      {#snippet leading()}
        <IconButton label="Back" variant="ghost"
          >{#snippet icon()}<ArrowLeft size={iconSizes.md} />{/snippet}</IconButton
        >
      {/snippet}
      {#snippet primaryActions()}<Button variant="primary">New sale</Button>{/snippet}
      {#snippet secondaryActions()}<Button variant="secondary">Export</Button>{/snippet}
      {#snippet overflowActions()}
        <IconButton label="More" variant="ghost"
          >{#snippet icon()}<Ellipsis size={iconSizes.md} />{/snippet}</IconButton
        >
      {/snippet}
    </PageHeader>
  {/snippet}
</Story>
