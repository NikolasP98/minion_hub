<script lang="ts" module>
  export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'touch';
</script>

<script lang="ts">
  interface Props {
    src?: string;
    /** Display name; initials fallback = first letters of first two words. */
    name: string;
    size?: AvatarSize;
    class?: string;
  }

  let { src, name, size = 'md', class: cls = '' }: Props = $props();

  // Remembering which src failed (instead of a boolean) auto-resets on src change.
  let failedSrc = $state<string | undefined>();

  const initials = $derived(
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase(),
  );

  const sizeVars: Record<AvatarSize, string> = {
    xs: 'var(--control-height-xs)',
    sm: 'var(--control-height-sm)',
    md: 'var(--control-height-md)',
    lg: 'var(--control-height-lg)',
    touch: 'var(--control-height-touch)',
  };
</script>

<span
  class={`avatar ${cls}`}
  style:width={sizeVars[size]}
  style:height={sizeVars[size]}
  role="img"
  aria-label={name}
>
  {#if src && src !== failedSrc}
    <img {src} alt={name} onerror={() => (failedSrc = src)} />
  {:else}
    <span class="initials" aria-hidden="true">{initials}</span>
  {/if}
</span>

<style>
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .initials {
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-medium);
    line-height: 1;
    user-select: none;
  }
</style>
