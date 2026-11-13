<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import EmailCard from '$lib/components/my-agent/EmailCard.svelte';
  import type { EmailItem } from '$lib/services/my-agent-rpc';

  const nowMs = Date.now();
  const item = (minutesAgo: number, extra: Partial<EmailItem> = {}): EmailItem => ({
    id: `em-${minutesAgo}`,
    sourceEmail: 'nikolas@example.com',
    from: 'Compras Proveedor <compras@proveedor-ejemplo.pe>',
    fromName: 'Compras Proveedor',
    subject: 'Confirmación de pedido 4471',
    date: new Date(nowMs - minutesAgo * 60_000).toUTCString(),
    receivedAt: new Date(nowMs - minutesAgo * 60_000).toISOString(),
    htmlLink: 'https://mail.google.com/',
    unread: true,
    snippet:
      'Le confirmamos el despacho para el martes. Adjuntamos la guía de remisión y la factura electrónica.',
    ...extra,
  });

  const { Story } = defineMeta({
    title: 'Components/Sessions/EmailCard',
    component: EmailCard,
    tags: ['autodocs'],
    argTypes: { isNew: { control: 'boolean' }, opened: { control: 'boolean' } },
    args: { item: item(35), nowMs, isNew: false, opened: false, onopen: fn() },
  });
</script>

<Story name="Unopened">
  {#snippet template(args)}<div class="w-80"><EmailCard {...args} /></div>{/snippet}
</Story>

<Story name="New" args={{ isNew: true, item: item(3) }}>
  {#snippet template(args)}<div class="w-80"><EmailCard {...args} /></div>{/snippet}
</Story>

<Story name="Opened" args={{ opened: true, item: item(26 * 60) }}>
  {#snippet template(args)}<div class="w-80"><EmailCard {...args} /></div>{/snippet}
</Story>

<Story
  name="With labels"
  args={{ item: item(90, { labels: ['Finanzas', 'Proveedores', 'Urgente'] }) }}
>
  {#snippet template(args)}<div class="w-80"><EmailCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Shared inbox"
  args={{ item: item(200, { shared: true, sharedOwnerName: 'Recepción' }) }}
>
  {#snippet template(args)}<div class="w-80"><EmailCard {...args} /></div>{/snippet}
</Story>

<Story
  name="No subject unknown sender no snippet"
  args={{ item: item(10 * 24 * 60, { from: '', fromName: '', subject: '', snippet: null }) }}
>
  {#snippet template(args)}<div class="w-80"><EmailCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Long subject and snippet"
  args={{
    item: item(50, {
      fromName: 'Superintendencia Nacional de Aduanas y de Administración Tributaria',
      subject:
        'Recordatorio: vencimiento de la declaración mensual PDT 621 y cronograma de obligaciones para contribuyentes del régimen MYPE',
      snippet:
        'Estimado contribuyente, le recordamos que el plazo para presentar la declaración vence según el último dígito de su RUC. Evite multas e intereses moratorios presentando a tiempo. Este mensaje es informativo y no requiere respuesta.',
    }),
  }}
>
  {#snippet template(args)}<div class="w-80"><EmailCard {...args} /></div>{/snippet}
</Story>
