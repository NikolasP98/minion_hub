<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AgentSettingsNav from '$lib/components/agents/AgentSettingsNav.svelte';

  const field = (key, label, isOverridden = false, help = '') => ({
    key,
    path: `agents.list[0].${key}`,
    schema: { type: 'string' },
    hint: { label, help },
    value: isOverridden ? 'custom' : undefined,
    defaultValue: '',
    isOverridden,
  });
  const g = (id, label, order, fields) => ({ group: { id, label, description: '', order }, fields, hasValues: true });
  const groups = [
    g('identity', 'Identity', 0, [field('name', 'Name', true), field('emoji', 'Emoji'), field('description', 'Description')]),
    g('model', 'Model', 1, [field('model', 'Model', true, 'Which model answers'), field('temperature', 'Temperature', true)]),
    g('workspace', 'Workspace', 2, [field('cwd', 'Working directory')]),
    g('memory-search', 'Memory search', 3, [field('memory.topK', 'Results per query')]),
    g('tool-profile', 'Tools', 4, [field('tools.profile', 'Tool profile', true)]),
    g('sandbox', 'Sandbox', 5, [field('sandbox.mode', 'Mode')]),
    g('advanced', 'Advanced', 6, [field('debug', 'Debug logging')]),
  ];

  const { Story } = defineMeta({
    title: 'Agents/AgentSettingsNav',
    component: AgentSettingsNav,
    tags: ['autodocs'],
    args: { activeSection: 'model', onselect: fn(), groups, enabledSkillCount: 4, totalSkillCount: 9, bindingCount: 2, searchQuery: '' },
  });
</script>

<Story name="Default">
  {#snippet template(args)}<div class="w-56 h-[28rem] bg-bg2"><AgentSettingsNav {...args} /></div>{/snippet}
</Story>

<Story name="No skills or bindings" args={{ enabledSkillCount: 0, totalSkillCount: 0, bindingCount: 0, activeSection: 'identity' }}>
  {#snippet template(args)}<div class="w-56 h-[28rem] bg-bg2"><AgentSettingsNav {...args} /></div>{/snippet}
</Story>

<Story name="No overrides" args={{ groups: groups.map((x) => ({ ...x, fields: x.fields.map((f) => ({ ...f, isOverridden: false })) })) }}>
  {#snippet template(args)}<div class="w-56 h-[28rem] bg-bg2"><AgentSettingsNav {...args} /></div>{/snippet}
</Story>

<Story name="Search query" args={{ searchQuery: 'temp' }}>
  {#snippet template(args)}<div class="w-56 h-[28rem] bg-bg2"><AgentSettingsNav {...args} /></div>{/snippet}
</Story>

<Story name="Only one group" args={{ groups: groups.slice(0, 1), activeSection: 'skills' }}>
  {#snippet template(args)}<div class="w-56 h-[28rem] bg-bg2"><AgentSettingsNav {...args} /></div>{/snippet}
</Story>
