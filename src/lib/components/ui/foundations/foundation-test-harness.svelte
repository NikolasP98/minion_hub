<script lang="ts">
  import { Button } from '@minion-stack/ui';
  import AppViewport from './AppViewport.svelte';
  import AsyncBoundary, { type AsyncBoundaryState } from './AsyncBoundary.svelte';
  import DraggableWindow from './DraggableWindow.svelte';
  import FormField, { type FormControlProps } from './FormField.svelte';
  import PageHeader from '../PageHeader.svelte';
  import PageBody from './PageBody.svelte';
  import PageShell from './PageShell.svelte';
  import SectionShell from './SectionShell.svelte';

  let { asyncState = { kind: 'ready' } }: { asyncState?: AsyncBoundaryState } = $props();
</script>

{#snippet control(props: FormControlProps)}
  <input {...props} name="agent-name" />
{/snippet}

{#snippet readyContent()}
  <p>Ready content</p>
{/snippet}

{#snippet primaryActions()}
  <Button>Publish</Button>
{/snippet}

{#snippet secondaryActions()}
  <Button variant="ghost">Preview</Button>
{/snippet}

{#snippet overflowActions()}
  <Button aria-label="More actions">More</Button>
{/snippet}

<FormField
  id="agent-name"
  label="Agent name"
  helper="Shown to operators"
  required
  children={control}
/>

<AsyncBoundary state={asyncState} children={readyContent} />

<AppViewport>
  <SectionShell>
    {#snippet navigation()}<nav aria-label="Test section">Section</nav>{/snippet}
    <PageShell archetype="collection" scroll="page" labelledBy="fixture-title">
      <PageHeader
        titleId="fixture-title"
        title="Agents"
        subtitle="Operator roster"
        {primaryActions}
        {secondaryActions}
        {overflowActions}
      />
      <PageBody><p>Collection body</p></PageBody>
    </PageShell>
  </SectionShell>
</AppViewport>

<DraggableWindow
  open
  title="Agent trace"
  keyboardInstructions="Use Alt plus arrow keys to move this window."
  resizeLabel="Resize agent trace"
  resizable
>
  <p>Trace body</p>
</DraggableWindow>
