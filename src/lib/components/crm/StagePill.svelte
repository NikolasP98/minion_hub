<script lang="ts">
  import { stageColor } from './crm-format';
  import { stageLabel } from './crm-i18n';
  let { stage, overridden = false }: { stage: string; overridden?: boolean } = $props();
</script>

<span class="pill" style:--c={stageColor(stage)}>
  {stageLabel(stage)}
  {#if overridden}<span class="dot" aria-hidden="true"></span>{/if}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
    white-space: nowrap;
  }
  .dot {
    width: 4px;
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--c);
  }
</style>
