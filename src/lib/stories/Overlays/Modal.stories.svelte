<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { Button } from '$lib/components/ui';

  const { Story } = defineMeta({
    title: 'Atoms/Overlays/Modal',
    component: Modal,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '420px' } } },
    argTypes: {
      size: { control: 'select', options: ['sm', 'md', 'lg', 'xl'] },
      dismissible: { control: 'boolean' },
      hideClose: { control: 'boolean' },
      dirty: { control: 'boolean' },
      guardDismiss: { control: 'boolean' },
    },
    args: {
      open: true,
      title: 'Edit customer',
      size: 'md',
      dismissible: true,
      hideClose: false,
      dirty: false,
      guardDismiss: true,
      onclose: fn(),
    },
  });
</script>

<script lang="ts">
  let triggerOpen = $state(false);
</script>

<Story name="Open">
  {#snippet template(args)}
    <Modal {...args}>
      <p class="text-sm text-foreground">
        Update the contact details and save. Changes apply immediately.
      </p>
    </Modal>
  {/snippet}
</Story>

<Story name="Small" args={{ size: 'sm', title: 'Delete record?' }}>
  {#snippet template(args)}
    <Modal {...args}>
      <p class="text-sm text-muted-foreground">This cannot be undone.</p>
      {#snippet footer()}
        <Button variant="ghost" size="sm">Cancel</Button>
        <Button variant="danger" size="sm">Delete</Button>
      {/snippet}
    </Modal>
  {/snippet}
</Story>

<Story name="Large" args={{ size: 'lg', title: 'Import products' }}>
  {#snippet template(args)}
    <Modal {...args}>
      <div class="grid grid-cols-2 gap-4 text-sm">
        {#each Array.from({ length: 8 }, (_, i) => i + 1) as n (n)}
          <div class="surface-2 rounded-[var(--radius-md)] p-3">Column mapping {n}</div>
        {/each}
      </div>
    </Modal>
  {/snippet}
</Story>

<Story name="Extra large" args={{ size: 'xl', title: 'Quarterly report preview' }}>
  {#snippet template(args)}
    <Modal {...args}>
      <p class="text-sm text-muted-foreground">Wide content area for tables and charts.</p>
    </Modal>
  {/snippet}
</Story>

<Story name="With footer" args={{ title: 'Save changes' }}>
  {#snippet template(args)}
    <Modal {...args}>
      <p class="text-sm">Three fields were edited.</p>
      {#snippet footer()}
        <Button variant="ghost" size="sm">Discard</Button>
        <Button size="sm">Save</Button>
      {/snippet}
    </Modal>
  {/snippet}
</Story>

<Story name="Custom header" args={{ title: 'Ignored when header snippet is set' }}>
  {#snippet template(args)}
    <Modal {...args}>
      {#snippet header()}
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-foreground">Invoice F001-000123</span>
          <span class="text-xs text-muted-foreground">Draft</span>
        </div>
      {/snippet}
      <p class="text-sm">Body content.</p>
    </Modal>
  {/snippet}
</Story>

<Story name="Not dismissible" args={{ dismissible: false, title: 'Processing payment' }}>
  {#snippet template(args)}
    <Modal {...args}>
      <p class="text-sm text-muted-foreground">Backdrop click and Escape do nothing here.</p>
    </Modal>
  {/snippet}
</Story>

<Story name="Hidden close button" args={{ hideClose: true, title: 'Choose a plan' }}>
  {#snippet template(args)}
    <Modal {...args}>
      <p class="text-sm">No X in the corner; use the footer actions.</p>
      {#snippet footer()}
        <Button size="sm">Continue</Button>
      {/snippet}
    </Modal>
  {/snippet}
</Story>

<Story name="Dirty (guarded dismiss)" args={{ dirty: true, title: 'Unsaved note' }}>
  {#snippet template(args)}
    <Modal {...args}>
      <p class="text-sm">Close it to see the discard-changes prompt.</p>
    </Modal>
  {/snippet}
</Story>

<Story name="Long content" args={{ title: 'Terms of service' }}>
  {#snippet template(args)}
    <Modal {...args}>
      <div class="space-y-3 text-sm text-muted-foreground">
        {#each Array.from({ length: 24 }, (_, i) => i + 1) as n (n)}
          <p>
            Clause {n}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod
            tempor incididunt ut labore et dolore magna aliqua.
          </p>
        {/each}
      </div>
    </Modal>
  {/snippet}
</Story>

<Story name="Trigger">
  {#snippet template()}
    <Button onclick={() => (triggerOpen = true)}>Open modal</Button>
    <Modal bind:open={triggerOpen} title="Opened from a button">
      <p class="text-sm">Close with the X, Escape, or the backdrop.</p>
    </Modal>
  {/snippet}
</Story>

<!-- Responsive: every size is clamped to the viewport minus the page gutter, so lg/xl collapse to full width on a phone. -->
<Story
  name="Large · Phone"
  args={{ size: 'lg', title: 'Import products' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}
    <Modal {...args}>
      <div class="grid grid-cols-2 gap-4 text-sm">
        {#each Array.from({ length: 8 }, (_, i) => i + 1) as n (n)}
          <div class="surface-2 rounded-[var(--radius-md)] p-3">Column mapping {n}</div>
        {/each}
      </div>
    </Modal>
  {/snippet}
</Story>

<Story
  name="Extra large · Tablet"
  args={{ size: 'xl', title: 'Quarterly report preview' }}
  globals={{ viewport: { value: 'tablet', isRotated: false } }}
>
  {#snippet template(args)}
    <Modal {...args}>
      <p class="text-sm text-muted-foreground">Wide content area for tables and charts.</p>
    </Modal>
  {/snippet}
</Story>
