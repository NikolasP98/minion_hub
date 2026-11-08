<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import FilterRuleEditor from '$lib/components/data-table/FilterRuleEditor.svelte';

  const options = [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'pending', label: 'Pending' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const { Story } = defineMeta({
    title: 'Data/FilterRuleEditor',
    component: FilterRuleEditor,
    tags: ['autodocs'],
    argTypes: {
      kind: { control: 'select', options: ['enum', 'text', 'number', 'date', 'boolean'] },
      operandOnly: { control: 'boolean' },
    },
    args: { kind: 'enum', options, value: { kind: 'enum', values: ['pending'] }, onValue: fn() },
  });
</script>

<Story name="Enum">
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterRuleEditor {...args} /></div>
  {/snippet}
</Story>

<Story name="Text" args={{ kind: 'text', options: [], value: { kind: 'text', op: 'contains', text: 'Mar' } }}>
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterRuleEditor {...args} /></div>
  {/snippet}
</Story>

<Story name="TextIsEmpty" args={{ kind: 'text', options: [], value: { kind: 'text', op: 'is_empty', text: '' } }}>
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterRuleEditor {...args} /></div>
  {/snippet}
</Story>

<Story name="Number" args={{ kind: 'number', options: [], value: { kind: 'number', op: 'between', min: 10, max: 2500000 } }}>
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterRuleEditor {...args} /></div>
  {/snippet}
</Story>

<Story name="DateAbsolute" args={{ kind: 'date', options: [], value: { kind: 'date', op: 'after', min: '2026-06-01', max: null } }}>
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterRuleEditor {...args} /></div>
  {/snippet}
</Story>

<Story name="DateRelative" args={{ kind: 'date', options: [], value: { kind: 'date', op: 'relative', rel: 'next_week', min: null, max: null } }}>
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterRuleEditor {...args} /></div>
  {/snippet}
</Story>

<Story name="Boolean" args={{ kind: 'boolean', options: [], value: { kind: 'boolean', op: 'checked' } }}>
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterRuleEditor {...args} /></div>
  {/snippet}
</Story>

<Story name="OperandOnly" args={{ operandOnly: true }}>
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterRuleEditor {...args} /></div>
  {/snippet}
</Story>
