<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Toaster from '$lib/components/layout/Toaster.svelte';
  import { Button } from '$lib/components/ui';
  import {
    toaster,
    toastSuccess,
    toastError,
    toastWarning,
    toastInfo,
    toastLoading,
  } from '$lib/state/ui/toast.svelte';

  // Toaster reads the global zag store; each story seeds it in `play`.
  // ToastItem is only reachable through Toaster (needs the group service), so it is covered here.
  const { Story } = defineMeta({
    title: 'Components/Overlays/Toaster',
    component: Toaster,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '320px' } } },
  });

  const forever = { duration: Infinity };
  function reset() {
    for (const t of toaster.getVisibleToasts()) toaster.remove(t.id);
  }
  const seed = (fn: () => void) => async () => {
    reset();
    fn();
  };
</script>

<Story
  name="Success"
  play={seed(() => toastSuccess('Invoice sent', 'F001-000123 emailed to the customer', forever))}
>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story
  name="Error"
  play={seed(() =>
    toastError('Payment failed', 'The card issuer declined the charge (code 05)', forever),
  )}
>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story
  name="Warning"
  play={seed(() => toastWarning('Low stock', '2 units of Keratin 500ml left', forever))}
>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story name="Info" play={seed(() => toastInfo('Sync scheduled', 'Next run at 02:00', forever))}>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story name="Loading" play={seed(() => toastLoading('Exporting report', 'This can take a minute'))}>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story name="Title only" play={seed(() => toastSuccess('Saved', undefined, forever))}>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story
  name="With action (not rendered by ToastItem)"
  play={seed(() =>
    toaster.create({
      title: 'Appointment deleted',
      description: 'ToastItem has no action slot yet',
      type: 'info',
      action: { label: 'Undo', onClick: () => {} },
      ...forever,
    }),
  )}
>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story
  name="Long message"
  play={seed(() =>
    toastError(
      'Could not import 3 of 240 rows',
      'Rows 12, 87 and 201 reference a product code that does not exist in this organisation. Fix the codes in the spreadsheet and import the file again; rows already imported are kept.',
      forever,
    ),
  )}
>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story
  name="Stacked (4)"
  play={seed(() => {
    toastSuccess('Customer created', 'Maria Fernandez', forever);
    toastInfo('Reminder sent', 'WhatsApp, 24h before', forever);
    toastWarning('Shift still open', 'Opened 16h ago by Carla', forever);
    toastError('Sync failed', 'SUNAT timed out', forever);
  })}
>
  {#snippet template()}<Toaster />{/snippet}
</Story>

<Story name="Trigger">
  {#snippet template()}
    <div class="flex flex-wrap gap-2">
      <Button size="sm" onclick={() => toastSuccess('Saved', 'All good')}>Success</Button>
      <Button size="sm" onclick={() => toastError('Failed', 'Try again')}>Error</Button>
      <Button size="sm" onclick={() => toastWarning('Careful', 'Check this')}>Warning</Button>
      <Button size="sm" onclick={() => toastInfo('FYI', 'Something happened')}>Info</Button>
      <Button size="sm" onclick={() => toastLoading('Working', 'Hold on')}>Loading</Button>
      <Button size="sm" variant="ghost" onclick={reset}>Clear</Button>
    </div>
    <Toaster />
  {/snippet}
</Story>

<!-- Responsive: the stack sits in the viewport corner; toasts narrow to the phone width. -->
<Story
  name="Stacked (4) · Phone"
  play={seed(() => {
    toastSuccess('Customer created', 'Maria Fernandez', forever);
    toastInfo('Reminder sent', 'WhatsApp, 24h before', forever);
    toastWarning('Shift still open', 'Opened 16h ago by Carla', forever);
    toastError('Sync failed', 'SUNAT timed out', forever);
  })}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template()}<Toaster />{/snippet}
</Story>
