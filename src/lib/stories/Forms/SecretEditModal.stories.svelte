<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import SecretEditModal from '$lib/components/settings/SecretEditModal.svelte';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const probe = (probeStatus, probeMessage, ms = 800) => async () => {
    await wait(ms);
    return { probeStatus, probeMessage };
  };

  const { Story } = defineMeta({
    title: 'Forms/SecretEditModal',
    component: SecretEditModal,
    tags: ['autodocs'],
    argTypes: { open: { control: 'boolean' } },
    args: { open: true, secretKey: 'ANTHROPIC_API_KEY', secretLabel: 'Anthropic API key', onClose: fn(), onSave: probe('ok', 'Key accepted, 3 models visible') },
  });
</script>

<Story name="Open">
  {#snippet template(args)}<SecretEditModal {...args} />{/snippet}
</Story>

<Story name="Closed" args={{ open: false }}>
  {#snippet template(args)}<p class="text-muted-foreground t-caption">Dialog is closed (toggle the `open` control).</p><SecretEditModal {...args} />{/snippet}
</Story>

<Story name="Probe: invalid" args={{ onSave: probe('invalid', 'Authentication failed (401)') }}>
  {#snippet template(args)}<SecretEditModal {...args} />{/snippet}
</Story>

<Story name="Probe: unknown" args={{ onSave: probe('unknown', '') }}>
  {#snippet template(args)}<SecretEditModal {...args} />{/snippet}
</Story>

<Story name="Probe: missing" args={{ onSave: probe('missing', 'Secret was not stored') }}>
  {#snippet template(args)}<SecretEditModal {...args} />{/snippet}
</Story>

<Story name="Save throws" args={{ onSave: async () => { await wait(500); throw new Error('Gateway unreachable'); } }}>
  {#snippet template(args)}<SecretEditModal {...args} />{/snippet}
</Story>

<Story name="Slow save (3 s, not dismissible)" args={{ onSave: probe('ok', 'Key accepted', 3000) }}>
  {#snippet template(args)}<SecretEditModal {...args} />{/snippet}
</Story>

<Story name="Long key and label" args={{ secretKey: 'EXTREMELY_LONG_PROVIDER_SPECIFIC_SECRET_KEY_NAME_FOR_THE_SECONDARY_REGION_FAILOVER_2026', secretLabel: 'Secondary region failover credential for the extremely long provider-specific integration' }}>
  {#snippet template(args)}<SecretEditModal {...args} />{/snippet}
</Story>
