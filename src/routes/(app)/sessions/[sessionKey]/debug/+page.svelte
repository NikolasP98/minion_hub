<script lang="ts">
  import { Button, Toggle } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import StepView from '$lib/components/debug/StepView.svelte';
  import StepStateView from '$lib/components/debug/StepStateView.svelte';
  import {
    debugSetSteppedBuild,
    debugSkipAll,
    debugStepContinue,
  } from '$lib/services/gateway.svelte';
  import {
    type DebugStepName,
    type DebugStepEvent,
    debugState,
    getSessionDebug,
    setSessionSteppedBuildEnabled,
  } from '$lib/state/debug';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { Bug } from 'lucide-svelte';

  const sessionKey = $derived(decodeURIComponent(page.params.sessionKey ?? ''));

  // Reactive read of the session's debug state via runed store
  const session = $derived(sessionKey ? debugState.sessions[sessionKey] ?? getSessionDebug(sessionKey) : null);

  let selectedStep = $state<DebugStepName | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const selectedEvent = $derived.by((): DebugStepEvent | null => {
    if (!session || !selectedStep) {
      // Default to most recent event
      return session?.events.at(-1) ?? null;
    }
    for (let i = session.events.length - 1; i >= 0; i -= 1) {
      const e = session.events[i];
      if (e?.step === selectedStep) return e;
    }
    return null;
  });

  async function handleToggle(enabled: boolean) {
    if (!sessionKey || busy) return;
    busy = true;
    error = null;
    try {
      await debugSetSteppedBuild(sessionKey, enabled);
      setSessionSteppedBuildEnabled(sessionKey, enabled);
    } catch (e) {
      error = `${m.debug_failedToggleStepping()}: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }

  async function handleContinue(step: DebugStepName) {
    if (!sessionKey) return;
    error = null;
    try {
      await debugStepContinue(sessionKey, step);
    } catch (e) {
      error = `${m.debug_continueFailed()}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function handleSkipAll() {
    if (!sessionKey) return;
    error = null;
    try {
      await debugSkipAll(sessionKey);
    } catch (e) {
      error = `${m.debug_skipAllFailed()}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  function handleSelect(step: DebugStepName) {
    selectedStep = step;
  }
</script>

<svelte:head>
  <title>Debug · {sessionKey} · Minion Hub</title>
</svelte:head>

<PageShell archetype="workspace" scroll="page" labelledBy="session-debug-title">
<PageHeader
  titleId="session-debug-title"
  title={m.debug_steppedBuildTitle()}
  subtitle={sessionKey || undefined}
>
  {#snippet leading()}
    <Bug size={16} class="text-accent shrink-0" />
  {/snippet}
  {#snippet actions()}
    <div class="status">
      {m.debug_gateway()}:
      <span class:on={conn.connected}>
        {conn.connected ? m.debug_statusConnected() : conn.connecting ? m.debug_statusConnecting() : m.debug_statusDisconnected()}
      </span>
    </div>
  {/snippet}
</PageHeader>
<PageBody width="content">
<AsyncBoundary
  state={!sessionKey
    ? { kind: 'error', description: m.debug_noSessionKeyInUrl() }
    : { kind: 'ready' }}
>
<div class="page">
    <section class="controls">
      <Toggle
        checked={session?.steppedBuildEnabled ?? false}
        ariaLabel={m.debug_steppedBuild()}
        disabled={busy || !conn.connected}
        onchange={handleToggle}
        size="md"
      />
      <span>{m.debug_steppedBuild()} {session?.steppedBuildEnabled ? m.debug_statusOn() : m.debug_statusOff()}</span>
      <Button
        variant="outline"
        size="sm"
        onclick={handleSkipAll}
        disabled={!session?.pausedStep}
      >
        ⏭ {m.debug_skipAllGates()}
      </Button>
      {#if session && session.timeoutCount > 0}
        <span class="timeout-badge">⚠ {m.debug_autoResumes({ count: session.timeoutCount })}</span>
      {/if}
    </section>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="grid">
      <StepView
        events={session?.events ?? []}
        pausedStep={session?.pausedStep ?? null}
        onContinue={handleContinue}
        onSelect={handleSelect}
      />
      <StepStateView event={selectedEvent} />
    </div>
</div>
</AsyncBoundary>
</PageBody>
</PageShell>

<style>
  .page {
    padding: var(--space-6, 1.5rem);
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 1rem);
  }

  .status {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-section-title, 0.9rem);
  }

  .status .on {
    color: var(--color-success-fg);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-4, 1rem);
    padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    flex-wrap: wrap;
  }

  .timeout-badge {
    margin-left: auto;
    font-size: var(--font-size-body, 0.8rem);
    color: var(--color-warning-fg);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(400px, 2fr);
    gap: var(--space-4, 1rem);
  }

  @media (max-width: 720px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }

  .error {
    color: var(--color-danger-fg);
    margin: 0;
    padding: var(--space-3, 0.75rem);
    background: var(--color-danger-surface);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
  }
</style>
