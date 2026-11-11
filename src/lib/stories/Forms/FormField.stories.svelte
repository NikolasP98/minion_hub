<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { FormField, Input, Textarea, Select, Checkbox, Toggle } from '@minion-stack/ui';

  const options = [
    { value: 'dni', label: 'DNI' },
    { value: 'ce', label: 'Carné de extranjería' },
    { value: 'passport', label: 'Passport' },
  ];

  const { Story } = defineMeta({
    title: 'Atoms/Inputs/FormField',
    component: FormField,
    tags: ['autodocs'],
    argTypes: {
      required: { control: 'boolean' },
      disabled: { control: 'boolean' },
      helper: { control: 'text' },
      error: { control: 'text' },
    },
    args: { label: 'Full name', required: false, disabled: false },
  });
</script>

<Story name="Input">
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Input
            id={c.id}
            disabled={c.disabled}
            required={c.required}
            placeholder="Lucía Fernández"
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Helper text" args={{ helper: 'As printed on the identity document.' }}>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Input
            id={c.id}
            disabled={c.disabled}
            required={c.required}
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story
  name="Error"
  args={{ error: 'Name is required.', helper: 'As printed on the identity document.' }}
>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Input
            id={c.id}
            error={c.invalid ? ' ' : undefined}
            disabled={c.disabled}
            required={c.required}
            value=""
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Required" args={{ required: true }}>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Input
            id={c.id}
            disabled={c.disabled}
            required={c.required}
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true, helper: 'Managed by the CRM sync.' }}>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Input
            id={c.id}
            disabled={c.disabled}
            required={c.required}
            value="Lucía Fernández"
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Textarea" args={{ label: 'Notes', helper: 'Visible to the whole team.' }}>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Textarea
            id={c.id}
            disabled={c.disabled}
            required={c.required}
            rows={3}
            placeholder="Allergies, preferences…"
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Select" args={{ label: 'Document type', required: true }}>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Select
            id={c.id}
            disabled={c.disabled}
            required={c.required}
            {options}
            value="dni"
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Select with error" args={{ label: 'Document type', error: 'Pick a document type.' }}>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Select
            id={c.id}
            disabled={c.disabled}
            required={c.required}
            {options}
            placeholder="Choose…"
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Checkbox" args={{ label: 'Consent', helper: 'Required before the first treatment.' }}>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Checkbox
            id={c.id}
            disabled={c.disabled}
            required={c.required}
            label="Patient signed the informed consent"
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Toggle" args={{ label: 'Reminders' }}>
  {#snippet template(args)}
    <div class="w-80">
      <FormField {...args}>
        {#snippet children(c)}<Toggle
            disabled={c.disabled}
            label="Send WhatsApp reminders"
            pressed
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story
  name="Long label and helper"
  args={{
    label:
      'Número de documento de identidad del titular de la cuenta (obligatorio para facturación electrónica)',
    helper:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    required: true,
  }}
>
  {#snippet template(args)}
    <div class="w-64">
      <FormField {...args}>
        {#snippet children(c)}<Input
            id={c.id}
            disabled={c.disabled}
            required={c.required}
          />{/snippet}
      </FormField>
    </div>
  {/snippet}
</Story>

<Story name="Form (every kind)">
  {#snippet template()}
    <div role="form" class="w-80 flex flex-col gap-4">
      <FormField label="Full name" required>
        {#snippet children(c)}<Input id={c.id} required={c.required} />{/snippet}
      </FormField>
      <FormField label="Document type" required>
        {#snippet children(c)}<Select
            id={c.id}
            required={c.required}
            {options}
            value="dni"
          />{/snippet}
      </FormField>
      <FormField label="Email" error="Enter a valid email.">
        {#snippet children(c)}<Input id={c.id} type="email" value="not-an-email" />{/snippet}
      </FormField>
      <FormField label="Notes" helper="Optional">
        {#snippet children(c)}<Textarea id={c.id} rows={2} />{/snippet}
      </FormField>
      <FormField label="Consent">
        {#snippet children(c)}<Checkbox id={c.id} label="Signed" />{/snippet}
      </FormField>
      <FormField label="Reminders"><Toggle label="WhatsApp" /></FormField>
    </div>
  {/snippet}
</Story>

<!-- Responsive: fields fill the form width. -->
<Story
  name="Form (every kind) · Phone"
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template()}
    <div role="form" class="w-full flex flex-col gap-4">
      <FormField label="Full name" required>
        {#snippet children(c)}<Input id={c.id} required={c.required} />{/snippet}
      </FormField>
      <FormField label="Document type" required>
        {#snippet children(c)}<Select
            id={c.id}
            required={c.required}
            {options}
            value="dni"
          />{/snippet}
      </FormField>
      <FormField label="Email" error="Enter a valid email.">
        {#snippet children(c)}<Input id={c.id} type="email" value="not-an-email" />{/snippet}
      </FormField>
      <FormField label="Notes" helper="Optional">
        {#snippet children(c)}<Textarea id={c.id} rows={2} />{/snippet}
      </FormField>
      <FormField label="Consent">
        {#snippet children(c)}<Checkbox id={c.id} label="Signed" />{/snippet}
      </FormField>
      <FormField label="Reminders"><Toggle label="WhatsApp" /></FormField>
    </div>
  {/snippet}
</Story>
