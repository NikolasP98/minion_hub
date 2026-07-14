<!--
  EntityChip — render an EntityRef (org / area / agent / skill / tool / user)
  inline inside a sentence with a small, kind-tinted icon next to its label.

  Usage:
    <EntityChip ref={orgRef(org)} />
    The ticket was routed to <EntityChip ref={areaRef(area)} /> and picked up by
    <EntityChip ref={agentRef(agent)} />.
-->
<script lang="ts">
  import { resolveIcon, type EntityRef } from '$lib/types/entities';

  interface Props {
    ref: EntityRef;
    size?: 'sm' | 'md';
    /** Render as an <a> when the ref has an href. */
    link?: boolean;
    class?: string;
  }

  let { ref, size = 'sm', link = true, class: cls = '' }: Props = $props();

  const Icon = $derived(resolveIcon(ref));
  const color = $derived(ref.color ?? 'var(--color-muted-foreground)');
  const px = $derived(size === 'sm' ? 12 : 14);
  const sizeCls = $derived(
    size === 'sm'
      ? 'text-[length:var(--font-size-caption)] px-1.5 py-0.5 gap-1'
      : 'text-xs px-2 py-0.5 gap-1.5',
  );
  const tint = $derived(
    `background-color: color-mix(in srgb, ${color} 14%, transparent); color: ${color}; border-color: color-mix(in srgb, ${color} 32%, transparent);`,
  );
  const isLink = $derived(link && !!ref.href);
</script>

{#snippet body()}
  {#if ref.imageUrl}
    <img
      src={ref.imageUrl}
      alt=""
      width={px}
      height={px}
      style:width="{px}px"
      style:height="{px}px"
      class="rounded-full object-cover shrink-0 bg-bg3"
      aria-hidden="true"
    />
  {:else}
    <Icon size={px} class="shrink-0" />
  {/if}
  <span class="truncate max-w-[14rem]">{ref.label}</span>
{/snippet}

{#if isLink}
  <a
    href={ref.href}
    class={`inline-flex items-center rounded-[var(--radius-sm)] border font-medium leading-none whitespace-nowrap align-middle no-underline hover:brightness-110 transition ${sizeCls} ${cls}`}
    style={tint}
    data-entity-kind={ref.kind}
  >
    {@render body()}
  </a>
{:else}
  <span
    class={`inline-flex items-center rounded-[var(--radius-sm)] border font-medium leading-none whitespace-nowrap align-middle ${sizeCls} ${cls}`}
    style={tint}
    data-entity-kind={ref.kind}
  >
    {@render body()}
  </span>
{/if}
