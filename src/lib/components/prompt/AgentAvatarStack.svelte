<script lang="ts">
  /**
   * AgentAvatarStack — overlapping circular chips showing which agents reference
   * a section. Idle: stacked with -ml overlap (compact). Hover the group:
   * chips spread apart with smooth stagger and reveal a tooltip per chip with
   * the agent name. 21st.dev-style affordance: the cluster behaves like a
   * single unit until inspected.
   *
   * Inputs:
   *   - agents: AgentRef[]            — pre-sorted; ordering is preserved
   *   - max?: number = 4              — visible chips before "+N" overflow
   *   - size?: number = 18            — chip diameter in px
   */

  export interface AgentRef {
    agentId: string;
    label: string;
    emoji?: string;
    avatarUrl?: string;
    theme?: string;
  }

  let {
    agents,
    max = 4,
    size = 18,
  }: {
    agents: AgentRef[];
    max?: number;
    size?: number;
  } = $props();

  const visible = $derived(agents.slice(0, max));
  const overflow = $derived(Math.max(0, agents.length - max));

  // Deterministic color per agentId (used for monogram fallback).
  function colorFor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue} 55% 45%)`;
  }

  function monogram(label: string): string {
    const m = label.trim().match(/[\p{L}\p{N}]/gu);
    return m ? m[0].toUpperCase() : "?";
  }
</script>

{#if agents.length > 0}
  <div
    class="avatar-stack group relative inline-flex items-center"
    style="--chip-size: {size}px;"
    role="group"
    aria-label={`${agents.length} agents`}
  >
    {#each visible as agent, i (agent.agentId)}
      <div
        class="chip relative"
        style="z-index: {visible.length - i};"
        title={agent.label}
      >
        {#if agent.avatarUrl}
          <img src={agent.avatarUrl} alt="" />
        {:else if agent.emoji}
          <span class="emoji">{agent.emoji}</span>
        {:else}
          <span class="mono" style="background:{colorFor(agent.agentId)};">
            {monogram(agent.label)}
          </span>
        {/if}
        <span class="tooltip">{agent.label}</span>
      </div>
    {/each}
    {#if overflow > 0}
      <div class="chip overflow" title={agents.slice(max).map((a) => a.label).join(", ")}>
        <span class="mono">+{overflow}</span>
        <span class="tooltip">
          {#each agents.slice(max) as a, i}
            {a.label}{i < overflow - 1 ? ", " : ""}
          {/each}
        </span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .avatar-stack {
    /* Group hover spreads chips apart by setting --gap. */
    --gap: -7px;
    transition: padding 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .avatar-stack:hover {
    --gap: 3px;
  }

  .chip {
    width: var(--chip-size);
    height: var(--chip-size);
    border-radius: 999px;
    margin-left: var(--gap);
    border: 1.5px solid var(--bg, #0a0a0a);
    background: var(--bg2, #141414);
    overflow: visible;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      margin-left 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
      transform 180ms ease-out,
      box-shadow 180ms ease-out;
  }
  .chip:first-child {
    margin-left: 0;
  }
  .chip:hover {
    transform: translateY(-1px) scale(1.18);
    box-shadow: 0 4px 10px -2px rgb(0 0 0 / 0.4);
    z-index: 1000 !important;
  }

  .chip > img,
  .chip > .emoji,
  .chip > .mono {
    width: 100%;
    height: 100%;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: calc(var(--chip-size) * 0.55);
    line-height: 1;
    user-select: none;
  }
  .chip > .mono {
    color: white;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    font-size: calc(var(--chip-size) * 0.5);
  }
  .chip.overflow > .mono {
    background: rgb(var(--accent-rgb, 250 204 21) / 0.2);
    color: rgb(var(--accent-rgb, 250 204 21));
    font-size: calc(var(--chip-size) * 0.42);
  }

  /* Tooltip: hidden by default, fades in on chip hover. Positioned above. */
  .tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(2px);
    padding: 3px 6px;
    border-radius: 4px;
    background: var(--bg, #0a0a0a);
    border: 1px solid var(--border, #2a2a2a);
    color: var(--fg, #e5e5e5);
    font-size: 10px;
    font-family: ui-monospace, monospace;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition:
      opacity 140ms ease-out,
      transform 140ms ease-out;
    z-index: 1001;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip:hover .tooltip {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
</style>
