<script lang="ts" module>
  export type TagDotOrigin = 'own' | 'contact' | 'product';
</script>

<script lang="ts">
  /**
   * Tiny dense-list tag indicator — the Svelte-rendered twin of the calendar
   * chip's raw-HTML `.ec-chip-tag` (`SchedulingCalendar.svelte`), including its
   * contact ring / product square shape. Do not change `chipHtml`'s own CSS;
   * this only copies the same pixel values so the two stay visually identical.
   */
  import * as m from '$lib/paraglide/messages';

  let {
    name,
    color = null,
    origin,
  }: {
    name: string;
    color?: string | null;
    origin?: TagDotOrigin;
  } = $props();

  const originLabel: Record<TagDotOrigin, () => string> = {
    own: m.calendar_tag_origin_own,
    contact: m.calendar_tag_origin_contact,
    product: m.calendar_tag_origin_service,
  };
  const label = $derived(origin ? `${name} · ${originLabel[origin]()}` : name);
</script>

<span
  class="tag-dot"
  class:contact={origin === 'contact'}
  class:product={origin === 'product'}
  style:--c={color ?? 'var(--color-accent)'}
  title={label}
></span>

<style>
  .tag-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--c);
    flex-shrink: 0;
  }
  .tag-dot.contact {
    box-shadow: 0 0 0 1.5px var(--color-surface-1);
    outline: 1px solid var(--c);
  }
  .tag-dot.product {
    border-radius: var(--radius-xs);
  }
</style>
