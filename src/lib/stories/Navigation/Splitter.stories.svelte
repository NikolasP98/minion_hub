<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import Splitter, { type CollapseLevel } from '$lib/components/layout/Splitter.svelte';

  const { Story } = defineMeta({
    title: 'Components/Navigation/Splitter',
    component: Splitter,
    tags: ['autodocs'],
    argTypes: {
      defaultSize: { control: { type: 'number', min: 5, max: 50 } },
      minibarSize: { control: { type: 'number', min: 3, max: 15 } },
      maxSize: { control: { type: 'number', min: 20, max: 60 } },
    },
    args: {
      storageKey: 'sb-splitter-default',
      defaultSize: 25,
      minibarSize: 6,
      maxSize: 40,
      oncollapse: fn(),
      onexpand: fn(),
    },
  });
</script>

{#snippet panel({ collapseLevel }: { collapseLevel: CollapseLevel })}
  <div class="h-full surface-1 p-3 text-sm text-foreground">
    <p class="font-medium">Left panel</p>
    <p class="text-xs text-muted-foreground">level: {collapseLevel}</p>
  </div>
{/snippet}

<Story name="Expanded">
  {#snippet template({ children: _children, ...args })}
    <div class="h-80 flex">
      <Splitter {...args} {panel}>
        <div class="p-3 text-sm text-muted-foreground">
          Content. Drag the handle; double-click toggles mini.
        </div>
      </Splitter>
    </div>
  {/snippet}
</Story>

<Story name="Mini bar" args={{ storageKey: 'sb-splitter-mini', onapi: (api) => api.mini() }}>
  {#snippet template({ children: _children, ...args })}
    <div class="h-80 flex">
      <Splitter {...args} {panel}>
        <div class="p-3 text-sm text-muted-foreground">Panel snapped to its minibar size.</div>
      </Splitter>
    </div>
  {/snippet}
</Story>

<Story
  name="Collapsed (popout tab)"
  args={{ storageKey: 'sb-splitter-collapsed', onapi: (api) => api.hide() }}
>
  {#snippet template({ children: _children, ...args })}
    <div class="h-80 flex">
      <Splitter {...args} {panel}>
        <div class="p-3 text-sm text-muted-foreground">
          Panel hidden; the chevron tab expands it.
        </div>
      </Splitter>
    </div>
  {/snippet}
</Story>

<Story name="Wide default" args={{ storageKey: 'sb-splitter-wide', defaultSize: 40, maxSize: 60 }}>
  {#snippet template({ children: _children, ...args })}
    <div class="h-80 flex">
      <Splitter {...args} {panel}>
        <div class="p-3 text-sm text-muted-foreground">40% panel.</div>
      </Splitter>
    </div>
  {/snippet}
</Story>

<!-- Responsive: the panel and content split the full viewport width. -->
<Story
  name="Expanded · Phone"
  args={{ storageKey: 'sb-splitter-phone' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template({ children: _children, ...args })}
    <div class="h-80 flex">
      <Splitter {...args} {panel}>
        <div class="p-3 text-sm text-muted-foreground">Content beside the panel at 390px.</div>
      </Splitter>
    </div>
  {/snippet}
</Story>
