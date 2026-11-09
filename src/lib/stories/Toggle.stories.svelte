<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Toggle } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Shared/Toggle',
    component: Toggle,
    tags: ['autodocs'],
    argTypes: {
      pressed: { control: 'boolean' },
      size: { control: 'select', options: ['sm', 'md', 'touch'] },
      disabled: { control: 'boolean' },
    },
    args: { label: 'Notifications', pressed: false, size: 'md', disabled: false },
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Toggle {...args} />
  {/snippet}
</Story>

<Story name="On" args={{ pressed: true }}>
  {#snippet template(args)}
    <Toggle {...args} />
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true, pressed: true }}>
  {#snippet template(args)}
    <Toggle {...args} />
  {/snippet}
</Story>

<Story name="Sizes">
  {#snippet template()}
    <div class="flex flex-col gap-3">
      {#each ['sm', 'md', 'touch'] as s (s)}<Toggle label={s} size={s} pressed />{/each}
    </div>
  {/snippet}
</Story>
