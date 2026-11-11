<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';

  // Search inside the picker hits `/api/crm/...` (unavailable here); the rail
  // states below are prop-driven.
  const { Story } = defineMeta({
    title: 'Components/Forms/CustomerPicker',
    component: CustomerPicker,
    tags: ['autodocs'],
    argTypes: { required: { control: 'boolean' }, label: { control: 'text' } },
    args: {
      partyId: null,
      customerName: null,
      phone: null,
      docNumber: null,
      required: false,
      requirements: null,
    },
  });
</script>

<Story name="Empty">
  {#snippet template(args)}<div class="w-80"><CustomerPicker {...args} /></div>{/snippet}
</Story>

<Story name="Empty, required" args={{ required: true }}>
  {#snippet template(args)}<div class="w-80"><CustomerPicker {...args} /></div>{/snippet}
</Story>

<Story
  name="Empty, org demands document and phone"
  args={{ requirements: { identityDocument: 'required', phone: 'required' } }}
>
  {#snippet template(args)}<div class="w-80"><CustomerPicker {...args} /></div>{/snippet}
</Story>

<Story
  name="Selected"
  args={{
    partyId: 'pt-1',
    customerName: 'Lucía Fernández',
    phone: '987654321',
    docNumber: '12345678',
  }}
>
  {#snippet template(args)}<div class="w-80"><CustomerPicker {...args} /></div>{/snippet}
</Story>

<Story name="Selected, name only" args={{ partyId: 'pt-2', customerName: 'Walk-in' }}>
  {#snippet template(args)}<div class="w-80"><CustomerPicker {...args} /></div>{/snippet}
</Story>

<Story
  name="Selected, missing required document"
  args={{
    partyId: 'pt-3',
    customerName: 'Marco Quispe',
    phone: '987654321',
    requirements: { identityDocument: 'required', phone: 'optional' },
  }}
>
  {#snippet template(args)}<div class="w-80"><CustomerPicker {...args} /></div>{/snippet}
</Story>

<Story
  name="Selected, missing document and phone"
  args={{
    partyId: 'pt-4',
    customerName: 'Marco Quispe',
    requirements: { identityDocument: 'required', phone: 'required' },
  }}
>
  {#snippet template(args)}<div class="w-80"><CustomerPicker {...args} /></div>{/snippet}
</Story>

<Story name="Custom label" args={{ label: 'Patient' }}>
  {#snippet template(args)}<div class="w-80"><CustomerPicker {...args} /></div>{/snippet}
</Story>

<Story
  name="Long name"
  args={{
    partyId: 'pt-5',
    customerName: 'Maximiliano Alejandro de la Cruz Villanueva-Echeverría y Sánchez de Lozada',
    phone: '987654321',
    docNumber: '12345678',
  }}
>
  {#snippet template(args)}<div class="w-64 border border-border">
      <CustomerPicker {...args} />
    </div>{/snippet}
</Story>
