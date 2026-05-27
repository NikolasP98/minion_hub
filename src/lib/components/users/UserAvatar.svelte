<script lang="ts">
  interface Props {
    name?: string | null;
    email?: string | null;
    src?: string | null;
    size?: number;
    class?: string;
  }

  let { name = null, email = null, src = null, size = 36, class: klass = '' }: Props = $props();

  const initials = $derived.by(() => {
    const base = (name ?? email ?? '').trim();
    if (!base) return '?';
    const parts = base.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return base.slice(0, 2).toUpperCase();
  });

  // Reset broken-image state when the source changes.
  let failed = $state(false);
  $effect(() => {
    void src;
    failed = false;
  });
</script>

{#if src && !failed}
  <img
    {src}
    alt={name ?? email ?? 'avatar'}
    width={size}
    height={size}
    style:width="{size}px"
    style:height="{size}px"
    class="rounded-full object-cover bg-bg3 border border-border {klass}"
    onerror={() => (failed = true)}
  />
{:else}
  <div
    style:width="{size}px"
    style:height="{size}px"
    style:font-size="{Math.max(10, Math.round(size * 0.36))}px"
    class="rounded-full bg-accent/20 border border-accent/30 text-accent font-bold flex items-center justify-center select-none {klass}"
  >
    {initials}
  </div>
{/if}
