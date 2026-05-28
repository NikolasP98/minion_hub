<script lang="ts" module>
  export type BadgeVariant = 'status' | 'semantic' | 'neutral';
  export type StatusValue = 'running' | 'thinking' | 'idle' | 'aborted';
  export type SemanticValue = 'success' | 'error' | 'warning' | 'info' | 'accent' | 'brand';
  export type BadgeSize = 'sm' | 'md';

  // Maps variant+value to the CSS token used for color/background tint.
  const STATUS_TOKEN: Record<StatusValue, string> = {
    running: 'var(--color-status-running)',
    thinking: 'var(--color-status-thinking)',
    idle: 'var(--color-status-idle)',
    aborted: 'var(--color-status-aborted)',
  };

  const SEMANTIC_TOKEN: Record<SemanticValue, string> = {
    success: 'var(--color-success)',
    error: 'var(--color-destructive)',
    warning: 'var(--color-warning)',
    info: 'var(--color-cyan)',
    accent: 'var(--color-accent)',
    brand: 'var(--color-brand-pink)',
  };

  export function resolveBadgeColor(
    variant: BadgeVariant,
    value: StatusValue | SemanticValue | undefined
  ): string | null {
    if (variant === 'status' && value && value in STATUS_TOKEN) {
      return STATUS_TOKEN[value as StatusValue];
    }
    if (variant === 'semantic' && value && value in SEMANTIC_TOKEN) {
      return SEMANTIC_TOKEN[value as SemanticValue];
    }
    return null;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: BadgeVariant;
    value?: StatusValue | SemanticValue;
    size?: BadgeSize;
    dot?: boolean;
    pulse?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    variant = 'neutral',
    value,
    size = 'md',
    dot = false,
    pulse = false,
    class: cls = '',
    children,
  }: Props = $props();

  const color = $derived(resolveBadgeColor(variant, value));

  const sizeCls = $derived(
    size === 'sm' ? 'text-[10px] px-1.5 py-0.5 gap-1' : 'text-xs px-2 py-0.5 gap-1.5'
  );

  const tintStyle = $derived(
    color
      ? `background-color: color-mix(in srgb, ${color} 18%, transparent); color: ${color}; border-color: color-mix(in srgb, ${color} 30%, transparent);`
      : ''
  );
</script>

<span
  class={`inline-flex items-center rounded-[var(--radius-sm)] border border-border font-medium leading-none whitespace-nowrap ${sizeCls} ${color ? '' : 'bg-bg3 text-muted-foreground'} ${cls}`}
  style={tintStyle}
>
  {#if dot}
    <span
      class={`inline-block rounded-full ${size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'} ${pulse ? 'animate-pulse' : ''}`}
      style={color ? `background-color: ${color};` : 'background-color: var(--color-muted-foreground);'}
      aria-hidden="true"
    ></span>
  {/if}
  {#if children}
    {@render children()}
  {:else if value}
    {value}
  {/if}
</span>
