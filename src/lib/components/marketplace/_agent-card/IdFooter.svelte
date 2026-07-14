<script lang="ts">
  import { RefreshCw } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

  interface Props {
    onFlip: (e: MouseEvent) => void;
  }
  let { onFlip }: Props = $props();
</script>

<div class="id-footer">
  <div class="company-brand">MINION</div>
  <Button
    type="button"
    variant="ghost"
    size="icon"
    class="role-desc-btn"
    aria-label={m.a11y_view_details()}
    onclick={(e) => {
      e.stopPropagation();
      onFlip(e);
    }}
  >
    <RefreshCw size={16} />
  </Button>
</div>

<style>
  .id-footer {
    display: flex;
    align-items: stretch;
    margin: 0 -20px -20px;
    min-height: 48px;
    position: relative;
    z-index: 3;
  }

  .company-brand {
    font-family: 'JetBrains Mono NF', monospace;
    font-weight: 800;
    font-size: var(--font-size-section-title, 16px);
    letter-spacing: 0.05em;
    flex: 1;
    display: flex;
    align-items: center;
    padding-left: 20px;
    color: #18181b;
    position: relative;
  }

  .company-brand::after {
    content: '';
    position: absolute;
    left: 20px;
    bottom: calc(50% - 11px);
    width: 46px;
    height: 2px;
    background: linear-gradient(90deg, var(--color-brand-pink), transparent);
    opacity: 0.85;
  }

  :global(.role-desc-btn) {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 20px;
    background: #18181b;
    color: #fafafa;
    border: none;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-standard);
    font-family: inherit;
  }

  :global(.role-desc-btn:hover) {
    background: #2c2c30;
  }
</style>
