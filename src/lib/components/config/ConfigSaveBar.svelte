<script lang="ts">
  import { configState, isDirty, dirtyPaths, save, discard, restartState, resetRestartState } from '$lib/state/config/config.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

{#if restartState.phase === 'restarting'}
  <!-- Restarting: spinner + message -->
  <div class="shrink-0 border-t border-border bg-bg2/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3 animate-slide-up restart-pulse">
    <span class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0"></span>
    <span class="text-foreground text-[11px] flex-1">Restarting gateway... Reconnecting</span>
    <button
      type="button"
      class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer font-[inherit] text-xs py-2 px-3 transition-colors hover:text-foreground disabled:opacity-40 disabled:cursor-default"
      disabled
    >
      {m.saveBar_discard()}
    </button>
    <button
      type="button"
      class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-2 px-4 opacity-40 cursor-default"
      disabled
    >
      {m.saveBar_saveChanges()}
    </button>
  </div>
{:else if restartState.phase === 'reconnected'}
  <!-- Reconnected: green success flash -->
  <div class="shrink-0 border-t border-border bg-bg2/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3 animate-slide-up reconnected-bar">
    <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
    <span class="flex-1">
      <span class="text-green-500 text-[11px] font-medium">Changes applied</span>
      {#if restartState.hadLocalChanges}
        <span class="text-amber-500 text-[10px] ml-2">You had unsaved changes that were preserved</span>
      {/if}
    </span>
  </div>
{:else if restartState.phase === 'failed'}
  <!-- Failed: error with retry -->
  <div class="shrink-0 border-t border-border bg-bg2/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3 animate-slide-up failed-bar">
    <svg class="w-4 h-4 text-destructive shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <span class="text-destructive text-[11px] flex-1">Reconnection failed</span>
    <button
      type="button"
      class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer font-[inherit] text-xs py-2 px-3 transition-colors hover:text-foreground"
      onclick={() => { resetRestartState(); wsConnect(); }}
    >
      Retry
    </button>
  </div>
{:else}
  <!-- Normal save bar (idle state) -->
  <div class="shrink-0 border-t border-border bg-bg2/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3 animate-slide-up">
    {#if configState.saveError}
      <span class="text-destructive text-[11px] flex-1 truncate">{configState.saveError}</span>
    {:else if configState.lastSavedAt && !isDirty.value}
      <span class="text-success text-[11px] flex-1">{m.saveBar_saved()}</span>
    {:else}
      <span class="text-muted-foreground text-[11px] flex-1">
        {dirtyPaths.value.size === 1
          ? '1 unsaved change'
          : `${dirtyPaths.value.size} unsaved changes`}
      </span>
    {/if}

    <button
      type="button"
      class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer font-[inherit] text-xs py-2 px-3 transition-colors hover:text-foreground disabled:opacity-40 disabled:cursor-default"
      disabled={!isDirty.value || configState.saving}
      onclick={() => discard()}
    >
      {m.saveBar_discard()}
    </button>

    <button
      type="button"
      class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-2 px-4 transition-[filter] hover:brightness-115 disabled:opacity-40 disabled:cursor-default flex items-center gap-2"
      disabled={!isDirty.value || configState.saving}
      onclick={() => save()}
    >
      {#if configState.saving}
        <span class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
      {/if}
      {m.saveBar_saveChanges()}
    </button>
  </div>
{/if}

<style>
  @keyframes slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .animate-slide-up {
    animation: slide-up 0.2s ease-out;
  }
  .restart-pulse {
    border-left: 2px solid var(--accent);
    animation: slide-up 0.2s ease-out, pulse-border 2s ease-in-out infinite;
  }
  @keyframes pulse-border {
    0%, 100% { border-left-color: var(--accent); }
    50% { border-left-color: transparent; }
  }
  .reconnected-bar {
    border-left: 2px solid #22c55e;
  }
  .failed-bar {
    border-left: 2px solid var(--destructive);
  }
</style>
