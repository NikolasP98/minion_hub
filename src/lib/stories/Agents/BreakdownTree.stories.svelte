<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import BreakdownTree from '$lib/components/prompt/BreakdownTree.svelte';
  import { promptSections } from '$lib/state/features/prompt-sections.svelte';

  const section = (id, layer, order, extra = {}) => ({
    id,
    layer,
    order,
    modes: ['full', 'minimal'],
    cacheable: true,
    enabled: true,
    source: 'builtin',
    ...extra,
  });
  const sections = [
    section('platform.safety', 'platform', 0),
    section('platform.tools', 'platform', 1),
    section('agent-type.copilot', 'agent-type', 0),
    section('identity.panik', 'identity', 0, { source: 'custom', agentId: 'panik' }),
    section('identity.voice', 'identity', 1, {
      source: 'custom',
      agentId: 'panik',
      enabled: false,
    }),
    section('user.preferences', 'user', 0),
    section('session.context', 'session', 0, { cacheable: false, modes: ['full'] }),
  ];
  const breakdown = sections.map((s, i) => ({
    id: s.id,
    layer: s.layer,
    order: s.order,
    bytes: 1_200 * (i + 1),
    tokens: 310 * (i + 1),
    cacheable: s.cacheable,
    source: s.source,
    rendered: '',
  }));
  const usage = {
    'platform.safety': [
      { agentId: 'panik', label: 'Panik' },
      { agentId: 'faces-clinic', label: 'Faces Clinic', emoji: '🦷' },
    ],
    'identity.panik': [{ agentId: 'panik', label: 'Panik' }],
  };

  // Reads the prompt-sections store (no data props). agentId stays null so the component
  // does not try to reload the list through the gateway on mount.
  const seed = (patch) => async () => {
    Object.assign(
      promptSections,
      {
        agentId: null,
        sections: [],
        disabledOverrides: [],
        selectedIds: new Set(),
        collapsedGroups: new Set(),
        isLoading: false,
        preview: null,
        usage: {},
      },
      patch,
    );
  };

  const { Story } = defineMeta({
    title: 'Agents/BreakdownTree',
    component: BreakdownTree,
    tags: ['autodocs'],
  });
</script>

<Story
  name="Populated with sizes and usage"
  play={seed({
    sections,
    usage,
    preview: {
      assembled: '',
      breakdown,
      totalBytes: 33_600,
      totalTokens: 8_680,
      tokenizer: 'cl100k',
    },
  })}
>
  {#snippet template()}<div class="w-[28rem] h-[30rem]"><BreakdownTree /></div>{/snippet}
</Story>

<Story
  name="Some selected and one layer collapsed"
  play={seed({
    sections,
    selectedIds: new Set(['platform.safety', 'user.preferences']),
    collapsedGroups: new Set(['session']),
  })}
>
  {#snippet template()}<div class="w-[28rem] h-[30rem]"><BreakdownTree /></div>{/snippet}
</Story>

<Story
  name="With disabled overrides"
  play={seed({ sections, disabledOverrides: ['platform.tools', 'user.preferences'] })}
>
  {#snippet template()}<div class="w-[28rem] h-[30rem]"><BreakdownTree /></div>{/snippet}
</Story>

<Story name="Loading" play={seed({ isLoading: true })}>
  {#snippet template()}<div class="w-[28rem] h-[30rem]"><BreakdownTree /></div>{/snippet}
</Story>

<Story name="Empty" play={seed()}>
  {#snippet template()}<div class="w-[28rem] h-[30rem]"><BreakdownTree /></div>{/snippet}
</Story>
