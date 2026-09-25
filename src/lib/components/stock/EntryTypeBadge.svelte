<script lang="ts">
  import { Badge, iconSizes } from '$lib/components/ui';
  import { entryTypeBadgeSpec } from './entry-type-badge';

  /**
   * Stock-entry TYPE pill (receipt/issue/transfer/adjustment) — same shape as
   * the Status column's Badge, with a leading icon so in/out/adjustment reads
   * at a glance instead of as plain colored text.
   */
  interface Props {
    type: string;
    /** Pre-localized label (e.g. `typeLabel(e.type)`) — kept out of this
     * component so it stays free of i18n concerns. */
    label: string;
  }

  let { type, label }: Props = $props();

  const spec = $derived(entryTypeBadgeSpec(type));
</script>

{#if spec}
  {@const Icon = spec.icon}
  <Badge variant="semantic" value={spec.value}>
    <Icon size={iconSizes.sm} aria-hidden="true" />
    {label}
  </Badge>
{:else}
  <Badge variant="neutral">{type}</Badge>
{/if}
