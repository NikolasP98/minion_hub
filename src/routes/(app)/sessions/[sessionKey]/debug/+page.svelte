<script lang="ts">
  import { page } from '$app/state';
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
      error = `Failed to ${enabled ? 'enable' : 'disable'} stepping: ${e instanceof Error ? e.message : String(e)}`;
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
      error = `Continue failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function handleSkipAll() {
    if (!sessionKey) return;
    error = null;
    try {
      await debugSkipAll(sessionKey);
    } catch (e) {
      error = `Skip all failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  function handleSelect(step: DebugStepName) {
    selectedStep = step;
  }
</script>

<svelte:head>
  <title>Debug · {sessionKey} · Minion Hub</title>
</svelte:head>

<div class="page">
  <header>
    <h1>Stepped build debug</h1>
    <div class="meta">
      <div>
        Session: <code>{sessionKey}</code>
      </div>
      <div class="status">
        Gateway:
        <span class:on={conn.connected}>
          {conn.connected ? 'connected' : conn.connecting ? 'connecting' : 'disconnected'}
        </span>
      </div>
    </div>
  </header>

  {#if !sessionKey}
    <p class="error">No sessionKey in URL.</p>
  {:else}
    <section class="controls">
      <label class="toggle">
        <input
          type="checkbox"
          checked={session?.steppedBuildEnabled ?? false}
          disabled={busy || !conn.connected}
          onchange={(e) => handleToggle((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>Stepped build {session?.steppedBuildEnabled ? 'ON' : 'OFF'}</span>
      </label>
      <button
        type="button"
        class="skip-btn"
        onclick={handleSkipAll}
        disabled={!session?.pausedStep}
      >
        ⏭ Skip all gates this turn
      </button>
      {#if session && session.timeoutCount > 0}
        <span class="timeout-badge">⚠ {session.timeoutCount} auto-resume(s)</span>
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

<style>
  .page {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .meta {
    display: flex;
    gap: 1.5rem;
    color: var(--fg-muted, #888);
    font-size: 0.9rem;
  }

  code {
    font-family: var(--font-mono, monospace);
    color: var(--fg, #ddd);
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
