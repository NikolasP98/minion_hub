<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { ComponentProps } from 'svelte';
  import PiAgentTemplates from '$lib/components/agents/PiAgentTemplates.svelte';
  import { piAgentState, type TemplateEntry } from '$lib/state/features/pi-agent-state.svelte';

  const now = Date.now();
  const templates: TemplateEntry[] = [
    {
      name: 'researcher',
      description: 'Reads the web and the docs, returns a sourced brief.',
      tags: ['read-only'],
      model: 'claude-sonnet-4-5',
      source: 'bundled',
      version: '1.4.0',
      spawnCount: 212,
      lastUsedAt: now - 4 * 60_000,
    },
    {
      name: 'writer',
      description: 'Turns a brief into customer-facing copy in Spanish.',
      tags: ['copy', 'es'],
      model: 'claude-haiku-4-5',
      source: 'workspace',
      spawnCount: 87,
      lastUsedAt: now - 3 * 3_600_000,
    },
    {
      name: 'ops-verifier-for-the-netcup-deploy-pipeline',
      description: 'Checks a deploy end to end.',
      tags: [],
      model: null,
      source: 'workspace',
      spawnCount: 0,
      lastUsedAt: null,
    },
  ];

  // No loader in the component; each story seeds the pi-agent store directly.
  const seed = (list: TemplateEntry[]) => async () => {
    piAgentState.templates = list;
  };
  // Expanding fetches `templates.get` (fails here) and then renders without detail.
  const expand: Play = async (ctx) => {
    await seed(templates)();
    await ctx.userEvent.click(ctx.canvas.getByText('researcher'));
  };

  const { Story } = defineMeta({
    title: 'Components/Agents/PiAgentTemplates',
    component: PiAgentTemplates,
    tags: ['autodocs'],
  });
  type Play = NonNullable<ComponentProps<typeof Story>['play']>;
</script>

<Story name="Populated" play={seed(templates)}>
  {#snippet template()}<div class="w-[32rem]"><PiAgentTemplates /></div>{/snippet}
</Story>

<Story name="Expanded row" play={expand}>
  {#snippet template()}<div class="w-[32rem]"><PiAgentTemplates /></div>{/snippet}
</Story>

<Story name="Empty" play={seed([])}>
  {#snippet template()}<div class="w-[32rem]"><PiAgentTemplates /></div>{/snippet}
</Story>
