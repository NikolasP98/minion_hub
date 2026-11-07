<script lang="ts">
  import type { PageData } from './$types';
  import { Blocks } from 'lucide-svelte';
  import { iconSizes, PageHeader, Toggle } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { setPluginEnabled, MODULES_QUERY_KEY } from '$lib/state/plugin-nav.svelte';
  import { queryClient } from '$lib/query/client';
  import { toggleIds } from '$lib/modules/availability';

  let { data }: { data: PageData } = $props();

  /** Label + description per manifest toggleId; an id without an entry shows its raw id. */
  const MODULE_TEXT: Record<string, { label: () => string; desc: () => string }> = {
    crm: { label: m.fin_module_crm, desc: m.fin_module_crm_desc },
    finances: { label: m.fin_module_finances, desc: m.fin_module_finances_desc },
    ads: { label: m.nav_ads, desc: m.settings_modules_adsDesc },
    sales: { label: m.nav_salesOrders, desc: m.settings_modules_salesOrdersDesc },
    support: { label: m.nav_support, desc: m.settings_modules_supportDesc },
    scheduling: { label: m.sched_module_scheduling, desc: m.sched_module_scheduling_desc },
    pos: { label: m.nav_pos, desc: m.settings_modules_posDesc },
    stock: { label: m.nav_stock, desc: m.settings_modules_stockDesc },
  };
  const ids = toggleIds();

  // Default true when absent (absent = enabled per modules.service.ts)
  let enabled = $state(
    // svelte-ignore state_referenced_locally
    Object.fromEntries(ids.map((id) => [id, data.modules[id] ?? true])) as Record<string, boolean>,
  );
  let moduleBusy = $state<string | null>(null);
  let moduleMsg = $state<{ id: string; ok: boolean; text: string } | null>(null);

  async function setModule(moduleId: string, value: boolean) {
    moduleBusy = moduleId;
    moduleMsg = null;
    try {
      const res = await fetch('/api/modules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ moduleId, enabled: value }),
      });
      if (res.ok) {
        setPluginEnabled(moduleId, value);
        void queryClient.invalidateQueries({ queryKey: MODULES_QUERY_KEY });
      } else {
        moduleMsg = { id: moduleId, ok: false, text: m.fin_module_error() };
        enabled[moduleId] = !value;
      }
    } catch {
      moduleMsg = { id: moduleId, ok: false, text: m.fin_module_error() };
      enabled[moduleId] = !value;
    } finally {
      moduleBusy = null;
    }
  }
</script>

<svelte:head><title>{m.settings_modules()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={m.settings_modules()} subtitle={m.settings_modules_subtitle()}>
    {#snippet leading()}
      <Blocks size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="grid gap-4 max-w-2xl">
      <section class="card">
        <header class="card-h">
          <Blocks size={iconSizes.sm} />
          <span>{m.fin_modules_card()}</span>
        </header>

        {#each ids as id (id)}
          {@const text = MODULE_TEXT[id]}
          <div class="mod-row">
            <div class="mod-info">
              <span class="mod-label">{text?.label() ?? id}</span>
              {#if text}<span class="t-caption">{text.desc()}</span>{/if}
            </div>
            <Toggle
              bind:checked={enabled[id]}
              ariaLabel={text?.label() ?? id}
              pending={moduleBusy === id}
              onchange={(v) => setModule(id, v)}
              size="md"
            />
          </div>
        {/each}

        {#if moduleMsg && !moduleMsg.ok}
          <p class="err-msg mt-2">{moduleMsg.text}</p>
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .card-h {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-body);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-3);
  }
  .mod-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .mod-row:last-of-type {
    border-bottom: none;
  }
  .mod-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
  .mod-label {
    font-size: var(--font-size-page-title);
    font-weight: 500;
  }
  .err-msg {
    font-size: var(--font-size-body);
    color: var(--color-destructive);
    margin-bottom: var(--space-2);
  }
</style>
