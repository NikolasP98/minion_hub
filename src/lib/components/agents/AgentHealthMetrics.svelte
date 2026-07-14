<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { StatusDot } from '$lib/components/ui';
  import { fmtTimeAgo } from '$lib/utils/format';
  import type { HealthMetrics } from '$lib/server/agents/health-metrics';

  let { health }: { health: HealthMetrics } = $props();

  const stateLabel = $derived(
    health.state === 'active'
      ? m.autonomous_status_active()
      : health.state === 'attention'
        ? m.autonomous_status_attention()
        : m.autonomous_status_disabled(),
  );
  const lastRun = $derived(health.lastRunAt != null ? fmtTimeAgo(health.lastRunAt) : '—');
  const runs = $derived(health.runs30d != null ? String(health.runs30d) : '—');
  const success = $derived(
    health.successRate != null ? `${Math.round(health.successRate * 100)}%` : '—',
  );
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
  <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-text-primary)]/[0.02] px-3 py-2.5">
    <p class="mb-1 text-[length:var(--font-size-telemetry)] font-medium uppercase tracking-wide text-[var(--color-text-primary)]/40">
      {m.agent_health_status()}
    </p>
    <StatusDot state={health.state} label={stateLabel} expanded />
  </div>
  {#each [[m.agent_health_last_run(), lastRun], [m.agent_health_runs_30d(), runs], [m.agent_health_success(), success]] as [label, value] (label)}
    <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-text-primary)]/[0.02] px-3 py-2.5">
      <p class="mb-1 text-[length:var(--font-size-telemetry)] font-medium uppercase tracking-wide text-[var(--color-text-primary)]/40">{label}</p>
      <p class="text-base font-semibold text-[var(--color-text-primary)]">{value}</p>
    </div>
  {/each}
</div>
