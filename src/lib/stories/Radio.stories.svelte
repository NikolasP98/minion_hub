<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Radio } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Shared/Radio',
    component: Radio,
    tags: ['autodocs'],
    argTypes: { disabled: { control: 'boolean' }, helper: { control: 'text' } },
    args: { label: 'Cash', value: 'cash', name: 'pay', disabled: false }
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Radio {...args} />
  {/snippet}
</Story>

<Story name="Group">
  {#snippet template()}
    <div class="flex flex-col gap-2">
      <Radio name="pay" value="cash" label="Cash" group="cash" />
      <Radio name="pay" value="card" label="Card" group="cash" helper="Visa or Mastercard" />
      <Radio name="pay" value="transfer" label="Transfer" group="cash" disabled />
    </div>
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true }}>
  {#snippet template(args)}
    <Radio {...args} />
  {/snippet}
</Story>
