<script lang="ts" module>
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

  // Variant → token-driven classes. Every variant defines hover + active(press) states.
  const VARIANT: Record<ButtonVariant, string> = {
    primary:
      'bg-accent text-accent-foreground hover:brightness-110 active:brightness-95 shadow-sm',
    secondary:
      'bg-bg3 text-foreground border border-[var(--hairline)] hover:bg-[var(--elevation-3-bg)]',
    ghost: 'bg-transparent text-muted hover:text-foreground hover:bg-white/[0.06]',
    danger:
      'bg-[color-mix(in_srgb,var(--color-destructive)_14%,transparent)] text-destructive border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-destructive)_22%,transparent)] hover:border-[color-mix(in_srgb,var(--color-destructive)_50%,transparent)]',
    outline:
      'bg-transparent text-accent border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)]',
  };

  const SIZE: Record<ButtonSize, string> = {
    sm: 'h-7 px-3 text-xs gap-1.5 rounded-[var(--radius-md)]',
    md: 'h-8 px-4 text-sm gap-2 rounded-[var(--radius-md)]',
    lg: 'h-10 px-5 text-sm font-semibold gap-2 rounded-[var(--radius-lg)]',
    icon: 'h-8 w-8 p-0 gap-0 rounded-[var(--radius-md)] justify-center',
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Loader2 } from 'lucide-svelte';

  interface Props {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Shows a width-preserving spinner and blocks interaction. */
    loading?: boolean;
    disabled?: boolean;
    /** Renders an <a> instead of <button> when set. */
    href?: string;
    type?: 'button' | 'submit' | 'reset';
    class?: string;
    /** Optional leading icon snippet (replaced by spinner while loading). */
    icon?: Snippet;
    children?: Snippet;
    onclick?: (e: MouseEvent) => void;
    /** Passthrough attributes (aria-label, title, form, target, …). */
    [key: string]: unknown;
  }

  let {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    href,
    type = 'button',
    class: cls = '',
    icon,
    children,
    onclick,
    ...rest
  }: Props = $props();

  const isDisabled = $derived(disabled || loading);
  const spinnerPx = $derived(size === 'lg' ? 16 : size === 'sm' ? 12 : 14);

  const base =
    'relative inline-flex items-center justify-center font-medium whitespace-nowrap select-none ' +
    'transition-[transform,background-color,border-color,color,filter,box-shadow] ' +
    'duration-[150ms] ease-[cubic-bezier(0.2,0,0,1)] ' +
    'active:scale-[0.97] active:duration-[75ms] ' +
    'disabled:opacity-40 disabled:pointer-events-none disabled:active:scale-100 ' +
    'aria-disabled:opacity-40 aria-disabled:pointer-events-none';

  const classes = $derived(`${base} ${VARIANT[variant]} ${SIZE[size]} ${cls}`);
</script>

<svelte:element
  this={href ? 'a' : 'button'}
  {href}
  type={href ? undefined : type}
  role={href ? 'button' : undefined}
  class={classes}
  disabled={href ? undefined : isDisabled}
  aria-disabled={href && isDisabled ? 'true' : undefined}
  aria-busy={loading ? 'true' : undefined}
  {onclick}
  {...rest}
>
  {#if loading}
    <Loader2 size={spinnerPx} class="animate-spin shrink-0" aria-hidden="true" />
  {:else if icon}
    {@render icon()}
  {/if}
  {#if children && size !== 'icon'}
    {@render children()}
  {:else if children && size === 'icon' && !icon && !loading}
    {@render children()}
  {/if}
</svelte:element>
