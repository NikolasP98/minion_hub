<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { untrack } from 'svelte';
  import AssistGuide from '$lib/components/assistant/AssistGuide.svelte';
  import { startGuide, endGuide } from '$lib/assistant/guide.svelte';
  import { Button, Input } from '$lib/components/ui';

  // AssistGuide reads the module-level `guide` state; each story starts a walkthrough
  // against the demo page below (targets are `data-assist` keys) and ends it on unmount.
  // untrack: startGuide reads guide.steps after writing it, so a tracked call would make
  // this attachment depend on the state it sets and restart the guide in a loop.
  const start = (steps) => () => {
    untrack(() => startGuide(steps));
    return endGuide;
  };
  const steps = [
    { target: 'demo.new', message: 'Click "New booking" to open the form.' },
    { target: 'demo.name', message: 'Type the contact name here. The field auto-advances once you type.' },
    { target: 'demo.save', message: 'Save. That is the whole flow.' },
  ];

  const { Story } = defineMeta({
    title: 'AI/AssistGuide',
    component: AssistGuide,
    tags: ['autodocs'],
  });
</script>

{#snippet page()}
  <div class="flex h-96 w-full max-w-xl flex-col gap-4 rounded-lg border border-border-default bg-canvas p-6">
    <div class="flex items-center justify-between">
      <h2 class="t-heading">Bookings</h2>
      <Button size="sm" data-assist="demo.new">New booking</Button>
    </div>
    <label class="flex flex-col gap-1 t-caption text-muted-foreground">
      Contact
      <span data-assist="demo.name"><Input placeholder="Ana Torres" /></span>
    </label>
    <div class="mt-auto flex justify-end">
      <Button variant="primary" size="sm" data-assist="demo.save">Save</Button>
    </div>
  </div>
{/snippet}

<Story name="Step 1 of 3">
  {#snippet template()}
    <div {@attach start(steps)}>{@render page()}<AssistGuide /></div>
  {/snippet}
</Story>

<Story name="Single step">
  {#snippet template()}
    <div {@attach start(steps.slice(2))}>{@render page()}<AssistGuide /></div>
  {/snippet}
</Story>

<Story name="Waiting for a target not on screen">
  {#snippet template()}
    <div {@attach start([{ target: 'demo.missing', message: 'Open the drawer first — this element is not mounted yet.' }])}>{@render page()}<AssistGuide /></div>
  {/snippet}
</Story>

<Story name="Long message">
  {#snippet template()}
    <div {@attach start([{ target: 'demo.name', message: 'The contact field accepts a name, a phone number or a document id. Start typing and pick from the suggestions; if the contact does not exist yet, press Enter to create it inline without leaving the booking form. '.repeat(2) }])}>{@render page()}<AssistGuide /></div>
  {/snippet}
</Story>

<Story name="Inactive no guide running">
  {#snippet template()}
    <div>{@render page()}<AssistGuide /></div>
  {/snippet}
</Story>
