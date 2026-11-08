<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '@minion-stack/ui';
  import { ShieldCheck } from 'lucide-svelte';
  import { iconSizes } from '$lib/components/ui/icon-sizes';
  import { canEditAccess } from '$lib/nav/nav-edit.svelte';
  import type { SectionAccessChoice } from '$lib/nav/section-access-context';
  import SectionAccessDialog from './SectionAccessDialog.svelte';
  import * as m from '$lib/paraglide/messages';
  let {
    target,
    choices = [],
    label = '',
    compact = false,
  }: {
    target?: string | null;
    choices?: SectionAccessChoice[];
    label?: string;
    compact?: boolean;
  } = $props();
  let open = $state(false);
  let trigger: HTMLElement | null = null;
  const selectedTarget = $derived(target ?? choices[0]?.target ?? null);
  async function restoreFocus() {
    await tick();
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
      return;
    }
    const fallback = document.querySelector<HTMLElement>(
      '[data-page-header] h1, [data-page-header] [id]',
    );
    if (fallback) {
      fallback.setAttribute('tabindex', '-1');
      fallback.focus({ preventScroll: true });
    }
  }
</script>

{#if canEditAccess() && selectedTarget}
  <span class="access-trigger">
    <Button
      variant="ghost"
      size="sm"
      shape={compact ? 'icon' : undefined}
      aria-label={m.sectionAccess_open({ name: label || selectedTarget })}
      onclick={(event) => {
        trigger = event.currentTarget;
        open = true;
      }}
    >
      <ShieldCheck size={iconSizes.sm} />
      {#if !compact}{m.sectionAccess_title()}{/if}
    </Button>
  </span>
  <SectionAccessDialog
    bind:open
    target={selectedTarget}
    {choices}
    onclose={() => void restoreFocus()}
  />
{/if}

<style>
  .access-trigger {
    display: inline-flex;
    flex: none;
  }
  .access-trigger :global(button) {
    min-height: var(--control-height-touch);
    min-width: var(--control-height-touch);
  }
</style>
