<script lang="ts">
  /**
   * The ⋯ for a card surface: which fields the cards show and in what order
   * (`FieldsList`, the DataTable column-menu idiom), persisted per viewer by
   * `createCardFields`. Sits in the surface's view-tools segment beside the
   * view switcher, never as a loose toolbar button.
   */
  import { SlidersHorizontal } from 'lucide-svelte';
  import { Popover, iconSizes } from '$lib/components/ui';
  import FieldsList from '$lib/components/scheduling/FieldsList.svelte';
  import type { CardFields } from '$lib/components/data-view/card-fields.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    fields,
    pref,
  }: {
    fields: Array<{ key: string; label: string }>;
    pref: CardFields;
  } = $props();
</script>

<Popover placement="bottom" label={m.card_fields_configure()}>
  {#snippet trigger()}
    <span class="dt-tool">
      <SlidersHorizontal size={iconSizes.sm} aria-hidden="true" />
    </span>
  {/snippet}
  <div class="cfm-panel">
    <FieldsList
      heading={m.cal_card_fields()}
      {fields}
      hidden={pref.hidden}
      order={pref.order}
      ontoggle={(k) => pref.toggle(k)}
      onmove={(from, to) => pref.move(from, to)}
    />
  </div>
</Popover>

<style>
  .cfm-panel {
    display: flex;
    flex-direction: column;
    min-width: 14rem;
    padding: var(--space-1);
  }
</style>
