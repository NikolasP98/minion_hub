<script lang="ts">
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

<PageHeader title={m.debug_steppedBuildTitle()} subtitle={sessionKey || undefined}>
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
<main class="flex-1 min-h-0 overflow-y-auto">
<div class="page">
  {#if !sessionKey}
    <p class="error">{m.debug_noSessionKeyInUrl()}</p>
  {:else}
    <section class="controls">
      <label class="toggle">
        <input
          type="checkbox"
          checked={session?.steppedBuildEnabled ?? false}
          disabled={busy || !conn.connected}
          onchange={(e) => handleToggle((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>{m.debug_steppedBuild()} {session?.steppedBuildEnabled ? m.debug_statusOn() : m.debug_statusOff()}</span>
      </label>
      <button
        type="button"
        class="skip-btn"
        onclick={handleSkipAll}
        disabled={!session?.pausedStep}
      >
        ⏭ {m.debug_skipAllGates()}
      </button>
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
  {/if}
</div>
</main>

<style>
  .page {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .status {
    color: var(--fg-muted, #888);
    font-size: 0.9rem;
  }

  .status .on {
    color: #4ade80;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--bg-card, #141414);
    border: 1px solid var(--bd, #2a2a2a);
    border-radius: 8px;
    flex-wrap: wrap;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    user-select: none;
  }

  .toggle input {
    width: 1.1rem;
    height: 1.1rem;
    cursor: pointer;
  }

  .skip-btn {
    background: transparent;
    border: 1px solid var(--bd, #2a2a2a);
    border-radius: 4px;
    padding: 0.4rem 0.85rem;
    color: var(--fg, #ddd);
    cursor: pointer;
    font: inherit;
  }

  .skip-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .skip-btn:not(:disabled):hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.04));
  }

  .timeout-badge {
    margin-left: auto;
    font-size: 0.8rem;
    color: var(--warn, #ffb84d);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(400px, 2fr);
    gap: 1rem;
  }

  @media (max-width: 720px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }

  .error {
    color: #f87171;
    margin: 0;
    padding: 0.75rem;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: 4px;
  }
</style>
