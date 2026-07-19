<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';
  import AutonomousAgentCard from '$lib/components/agents/AutonomousAgentCard.svelte';
  import { Badge, PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import { gatewayAgentToVM, type AutonomousAgentVM } from '$lib/agents/autonomous';
  import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { configState, loadConfig, getField } from '$lib/state/config/config.svelte';
  import { sortedSystemAutomations, unscheduledCount } from '$lib/automations/system-automations';

  let {
    data,
  }: {
    data: {
      systemAgents: AutonomousAgentVM[];
      workforceAgents: AutonomousAgentVM[];
      isAdmin: boolean;
      artifactsByAgent: Record<string, ArtifactDescriptor[]>;
    };
  } = $props();

  onMount(() => {
    // Archetype lives in gateway config (agents.list[].archetype); ensure loaded.
    if (conn.connected && !configState.loaded && !configState.loading) loadConfig();
  });

  // id → archetype map from gateway config, same source AgentSidebar reads.
  const archetypeById = $derived.by(() => {
    const list = getField('agents.list');
    const map: Record<string, string> = {};
    if (Array.isArray(list)) {
      for (const a of list as Array<{ id?: string; archetype?: string }>) {
        if (a && typeof a.id === 'string' && typeof a.archetype === 'string')
          map[a.id] = a.archetype;
      }
    }
    return map;
  });

  const gatewayVMs = $derived(
    visibleAgents.value
      .map((a) =>
        gatewayAgentToVM(
          a as { id: string; name?: string; status?: string },
          archetypeById[(a as { id: string }).id],
        ),
      )
      .filter((vm): vm is AutonomousAgentVM => vm !== null),
  );

  // Core autonomous agents = built-in system agents + gateway autonomous agents.
  const agents = $derived<AutonomousAgentVM[]>([...data.systemAgents, ...gatewayVMs]);
  const workforceAgents = $derived(data.workforceAgents ?? []);
  // System automations: cron-driven, no agent behind them. Static manifest —
  // scheduling lives on netcup, outside this app.
  const systemAutomations = sortedSystemAutomations();
  const unscheduled = unscheduledCount();
  const cadenceLabel: Record<string, () => string> = {
    minute: m.automation_cadence_minute,
    hourly: m.automation_cadence_hourly,
    daily_3am: m.automation_cadence_daily_3am,
  };
  const wiringLabel: Record<string, () => string> = {
    netcup: m.automation_wiring_netcup,
    vercel: m.automation_wiring_vercel,
    unscheduled: m.automation_wiring_unscheduled,
  };
  // Static per-key lookups: paraglide messages are referenced by name so unused-
  // message tooling still sees them (a dynamic `m[\`automation_${key}\`]` would
  // hide every one of them and doesn't typecheck against the generated module).
  const copy: Record<string, { title: () => string; desc: () => string }> = {
    reminders: { title: m.automation_reminders_title, desc: m.automation_reminders_desc },
    finance_sync: { title: m.automation_finance_sync_title, desc: m.automation_finance_sync_desc },
    notifications: { title: m.automation_notifications_title, desc: m.automation_notifications_desc },
    jobs: { title: m.automation_jobs_title, desc: m.automation_jobs_desc },
    org_config: { title: m.automation_org_config_title, desc: m.automation_org_config_desc },
    retention: { title: m.automation_retention_title, desc: m.automation_retention_desc },
    memberships: { title: m.automation_memberships_title, desc: m.automation_memberships_desc },
    finance_daily: { title: m.automation_finance_daily_title, desc: m.automation_finance_daily_desc },
    dni: { title: m.automation_dni_title, desc: m.automation_dni_desc },
    meta_sync: { title: m.automation_meta_sync_title, desc: m.automation_meta_sync_desc },
    email_ledger: { title: m.automation_email_ledger_title, desc: m.automation_email_ledger_desc },
    vectorize: { title: m.automation_vectorize_title, desc: m.automation_vectorize_desc },
    analyze: { title: m.automation_analyze_title, desc: m.automation_analyze_desc },
  };

  const pageState = $derived(
    agents.length === 0 && workforceAgents.length === 0
      ? { kind: 'empty' as const, title: m.autonomous_empty() }
      : { kind: 'ready' as const },
  );
</script>

<PageShell archetype="collection" scroll="region" labelledBy="autonomous-page-title">
  <PageHeader
    title={m.autonomous_page_title()}
    subtitle={m.autonomous_page_subtitle()}
    titleId="autonomous-page-title"
  />
  <PageBody width="content" scroll="region">
    <AsyncBoundary state={pageState}>
      {#if agents.length > 0}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {#each agents as agent (agent.id)}
            <AutonomousAgentCard
              {agent}
              artifacts={data.artifactsByAgent[agent.id] ?? []}
              canAdd={data.isAdmin}
            />
          {/each}
        </div>
      {/if}

      {#if workforceAgents.length > 0}
        <!-- Segregated group: agents that belong to the Workforce module. They are
           event-driven (act on issue create/update), hence autonomous. -->
        <section class="mt-8">
          <div class="mb-1 flex items-center gap-2">
            <h2 class="t-title">{m.autonomous_workforce_section()}</h2>
            <Badge variant="semantic" value="accent" size="sm"
              >{m.autonomous_workforce_badge()}</Badge
            >
            <span class="t-caption">{workforceAgents.length}</span>
          </div>
          <p class="mb-3 t-caption">{m.autonomous_workforce_section_desc()}</p>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {#each workforceAgents as agent (agent.id)}
              <AutonomousAgentCard {agent} canAdd={false} />
            {/each}
          </div>
        </section>
      {/if}

      <!-- Segregated group, always last: SYSTEM automations. Not agents — cron
         endpoints on a schedule. `unscheduled` is the one that matters: an
         endpoint can exist, be allowlisted, and still never be called. -->
      <section class="mt-8">
        <div class="mb-1 flex items-center gap-2">
          <h2 class="t-title">{m.automation_system_section()}</h2>
          <Badge variant="semantic" value="info" size="sm">{m.automation_system_badge()}</Badge>
          <span class="t-caption">{systemAutomations.length}</span>
          {#if unscheduled > 0}
            <Badge variant="semantic" value="warning" size="sm"
              >{m.automation_unscheduled_warn({ count: unscheduled })}</Badge
            >
          {/if}
        </div>
        <p class="mb-3 t-caption">{m.automation_system_desc()}</p>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {#each systemAutomations as a (a.path)}
            <article class="auto-card" class:unwired={a.wiring === 'unscheduled'}>
              <header class="mb-1 flex items-baseline justify-between gap-2">
                <h3 class="t-label">{copy[a.key].title()}</h3>
                <Badge
                  variant="semantic"
                  value={a.wiring === 'unscheduled' ? 'warning' : 'success'}
                  size="sm">{wiringLabel[a.wiring]()}</Badge
                >
              </header>
              <p class="t-caption">{copy[a.key].desc()}</p>
              <footer class="mt-2 flex items-center justify-between gap-2">
                <code class="auto-path t-mono">{a.path}</code>
                <span class="t-caption">{cadenceLabel[a.cadence]()}</span>
              </footer>
            </article>
          {/each}
        </div>
      </section>
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  .auto-card {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
  }
  .auto-card.unwired {
    border-color: var(--color-warning-border);
    background: var(--color-warning-surface);
  }
  .auto-path {
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
