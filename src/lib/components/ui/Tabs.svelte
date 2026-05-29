<script lang="ts" module>
  export type TabsSize = 'sm' | 'md';
  export type TabItem = {
    value: string;
    label: string;
    /** lucide icon component (optional). */
    icon?: unknown;
    /** Small count/badge shown after the label. */
    count?: number | string;
    disabled?: boolean;
  };
</script>

<script lang="ts">
  interface Props {
    tabs: TabItem[];
    /** Bindable active tab value. */
    value?: string;
    size?: TabsSize;
    /** Stretch tabs to fill the row. */
    fitted?: boolean;
    class?: string;
    'aria-label'?: string;
    onValueChange?: (value: string) => void;
  }

  let {
    tabs,
    value = $bindable(tabs[0]?.value ?? ''),
    size = 'md',
    fitted = false,
    class: cls = '',
    'aria-label': ariaLabel,
    onValueChange,
  }: Props = $props();

  let tablistEl: HTMLDivElement | undefined = $state();

  const padCls = $derived(size === 'sm' ? 'px-2.5 h-8 text-xs' : 'px-3.5 h-9 text-sm');

  function select(v: string) {
    if (v === value) return;
    value = v;
    onValueChange?.(v);
  }

  // Roving arrow-key navigation across enabled tabs.
  function onKeydown(e: KeyboardEvent) {
    const enabled = tabs.filter((t) => !t.disabled);
    const idx = enabled.findIndex((t) => t.value === value);
    if (idx === -1) return;
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    else return;
    e.preventDefault();
    const target = enabled[next];
    select(target.value);
    tablistEl?.querySelector<HTMLElement>(`[data-tab="${target.value}"]`)?.focus();
  }
</script>

<div
  bind:this={tablistEl}
  role="tablist"
  tabindex={-1}
  aria-label={ariaLabel}
  onkeydown={onKeydown}
  class={`relative flex items-center gap-1 border-b border-[var(--hairline)] ${fitted ? 'w-full' : ''} ${cls}`}
>
  {#each tabs as tab (tab.value)}
    {@const active = tab.value === value}
    {@const Icon = tab.icon}
    <button
      type="button"
      role="tab"
      data-tab={tab.value}
      aria-selected={active}
      tabindex={active ? 0 : -1}
      disabled={tab.disabled}
      onclick={() => select(tab.value)}
      class={`relative inline-flex items-center justify-center gap-1.5 -mb-px border-b-2 font-medium whitespace-nowrap
        transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]
        disabled:opacity-40 disabled:cursor-not-allowed ${padCls} ${fitted ? 'flex-1' : ''}
        ${active
          ? 'border-accent text-foreground'
          : 'border-transparent text-muted hover:text-foreground hover:border-white/15'}`}
    >
      {#if Icon}
        {@const IconComp = Icon as typeof import('lucide-svelte').Activity}
        <IconComp size={size === 'sm' ? 13 : 15} class="shrink-0" />
      {/if}
      {tab.label}
      {#if tab.count !== undefined}
        <span
          class={`ml-0.5 rounded-full px-1.5 text-[10px] leading-[1.4] ${active ? 'bg-accent/15 text-accent' : 'bg-bg3 text-muted-foreground'}`}
        >{tab.count}</span>
      {/if}
    </button>
  {/each}
</div>
