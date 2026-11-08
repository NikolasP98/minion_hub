<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import BugReporter from '$lib/components/layout/BugReporter.svelte';
  import { bugReporter, cancelReport } from '$lib/state/ui/bug-reporter.svelte';

  // Driven entirely by the bug-reporter state module; each story seeds a phase.
  // Dummy screenshot: a flat grey SVG (fixture content, not UI styling).
  const screenshot =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="gray"/><text x="20" y="100" font-size="20" fill="white">screenshot</text></svg>');
  const logs = [
    { level: 'error', message: 'TypeError: cannot read properties of undefined (reading "id")', timestamp: Date.now() - 4000, stack: 'at Sell.svelte:120' },
    { level: 'warn', message: '[hosts] token fetch failed: 401', timestamp: Date.now() - 3000 },
    { level: 'info', message: 'ws connected in 212ms', timestamp: Date.now() - 2000 },
    { level: 'log', message: 'render /pos/sell', timestamp: Date.now() - 1000 },
  ];

  const seed = (patch) => async () => {
    cancelReport();
    Object.assign(bugReporter, patch);
  };

  const { Story } = defineMeta({
    title: 'Overlays/BugReporter',
    component: BugReporter,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '560px' } } },
  });
</script>

<Story name="Previewing (no screenshot)" play={seed({ phase: 'previewing' })}>
  {#snippet template()}<BugReporter />{/snippet}
</Story>

<Story name="Previewing with screenshot, logs and pasted images" play={seed({ phase: 'previewing', screenshotDataUrl: screenshot, pastedImages: [screenshot, screenshot], consoleLogs: logs, severity: 'high', comment: 'Charging a split appointment throws.' })}>
  {#snippet template()}<BugReporter />{/snippet}
</Story>

<Story name="Logs expanded" play={seed({ phase: 'previewing', consoleLogs: logs, logsCollapsed: false })}>
  {#snippet template()}<BugReporter />{/snippet}
</Story>

<Story name="Minimized" play={seed({ phase: 'minimized', screenshotDataUrl: screenshot, comment: 'Draft comment kept while minimized' })}>
  {#snippet template()}<BugReporter />{/snippet}
</Story>

<Story name="Camera flash" play={seed({ phase: 'capturing', flashVisible: true })}>
  {#snippet template()}<BugReporter />{/snippet}
</Story>

<Story name="Idle (renders nothing)" play={seed({})}>
  {#snippet template()}
    <p class="text-sm text-muted-foreground">Nothing mounts until a capture starts.</p>
    <BugReporter />
  {/snippet}
</Story>

<!-- Responsive: the 420px panel becomes edge-to-edge (max-sm) on a phone. -->
<Story name="Previewing with screenshot, logs and pasted images · Phone" play={seed({ phase: 'previewing', screenshotDataUrl: screenshot, pastedImages: [screenshot, screenshot], consoleLogs: logs, severity: 'high', comment: 'Charging a split appointment throws.' })} globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template()}<BugReporter />{/snippet}
</Story>
