<script lang="ts">
  import Sparkline from './Sparkline.svelte';
  import { agentActivity, agentChat } from '$lib/state/chat.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import type { Agent } from '$lib/types/gateway';

  let { agent, selected, accentColor, onclick }: {
    agent: Agent;
    selected: boolean;
    accentColor: string;
    onclick: () => void;
  } = $props();

  const act = $derived(agentActivity[agent.id]);
  const chat = $derived(agentChat[agent.id]);

  const activeSessions = $derived(
    gw.sessions.filter((s) => {
      const sk = (s as { sessionKey?: string }).sessionKey ?? '';
      const status = ui.sessionStatus[sk];
      return sk.includes(`agent:${agent.id}:`) && (status === 'running' || status === 'thinking');
    })
  );

  const statusText = $derived.by(() => {
    if (act?.working) return 'Working…';
    if (activeSessions.length > 0) return `${activeSessions.length} active`;
    if (chat?.loading) return 'Loading…';
    return 'Idle';
  });
</script>

<div
  class="agent-row {selected ? 'selected' : ''}"
  style="--row-accent: {accentColor}"
  role="button"
  tabindex="0"
  {onclick}
  onkeydown={(e) => e.key === 'Enter' && onclick()}
>
  <div class="row-top">
    <span class="agent-name">{agent.emoji ?? '🤖'} {agent.name ?? agent.id}</span>
  </div>
  <div class="row-status {act?.working || activeSessions.length > 0 ? 'has-active' : ''}">
    {statusText}
  </div>
  <div class="row-spark">
    <Sparkline bins={act?.sparkBins ?? new Array(30).fill(0)} color={accentColor} />
  </div>
</div>

<style>
  .agent-row {
    display: flex;
    flex-direction: column;
    padding: 10px 14px;
    border-left: 3px solid transparent;
    border-bottom: 1px solid rgba(42, 53, 72, 0.5);
    cursor: pointer;
    transition: background 0.12s;
  }
  .agent-row:hover { background: rgba(255, 255, 255, 0.03); }
  .agent-row.selected {
    background: var(--bg3);
    border-left-color: var(--row-accent, var(--accent));
  }
  .row-top { display: flex; align-items: center; gap: 6px; }
  .agent-name { font-size: 13px; font-weight: 600; color: var(--text); }
  .row-status {
    font-size: 11px;
    color: var(--text3);
    margin-top: 2px;
  }
  .row-status.has-active { color: var(--status-running); }
  .row-spark { margin-top: 5px; height: 28px; }
</style>
