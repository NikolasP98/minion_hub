<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ValidationErrors from '$lib/components/prompt/ValidationErrors.svelte';

  const errors = [
    { rule: 'no-secrets', match: 'sk-live-4f8a…', severity: 'block' },
    { rule: 'no-customer-pii', match: 'DNI 72345678', severity: 'block' },
    { rule: 'prefer-second-person', match: 'the assistant should', severity: 'warn' },
    { rule: 'max-section-bytes', severity: 'warn' },
  ];

  const { Story } = defineMeta({
    title: 'Agents/ValidationErrors',
    component: ValidationErrors,
    tags: ['autodocs'],
    args: { errors },
  });
</script>

<Story name="Blocks and warnings">
  {#snippet template(args)}<div class="w-96"><ValidationErrors {...args} /></div>{/snippet}
</Story>

<Story name="Warnings only" args={{ errors: errors.filter((e) => e.severity === 'warn') }}>
  {#snippet template(args)}<div class="w-96"><ValidationErrors {...args} /></div>{/snippet}
</Story>

<Story name="Long match" args={{ errors: [{ rule: 'no-secrets', match: 'ghp_9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a3', severity: 'block' }] }}>
  {#snippet template(args)}<div class="w-96"><ValidationErrors {...args} /></div>{/snippet}
</Story>

<Story name="Empty" args={{ errors: [] }}>
  {#snippet template(args)}<div class="w-96"><ValidationErrors {...args} /></div>{/snippet}
</Story>
