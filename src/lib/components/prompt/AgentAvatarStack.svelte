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
    --gap: calc(-1 * var(--space-2));
    transition: padding 220ms var(--ease-standard);
  }
  .avatar-stack:hover {
    --gap: var(--space-1);
  }

  .chip {
    width: var(--chip-size);
    height: var(--chip-size);
    border-radius: var(--radius-full);
    margin-left: var(--gap);
    border: 1.5px solid var(--color-canvas);
    background: var(--color-bg2, var(--color-surface-1));
    overflow: visible;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: margin-left 280ms var(--ease-standard),
      transform 180ms var(--ease-standard),
      box-shadow 180ms var(--ease-standard);
  }
  .chip:first-child {
    margin-left: 0;
  }
  .chip:hover {
    transform: translateY(-1px) scale(1.18);
    box-shadow: var(--shadow-elevation-1);
    z-index: var(--layer-debug) !important;
  }

  .chip > img,
  .chip > .emoji,
  .chip > .mono {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-body);
    line-height: 1;
    user-select: none;
  }
  .chip > .mono {
    color: var(--color-text-primary);
    font-weight: 600;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-caption);
  }
  .chip.overflow > .mono {
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: var(--color-accent);
    font-size: var(--font-size-telemetry);
  }

  /* Tooltip: hidden by default, fades in on chip hover. Positioned above. */
  .tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(2px);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-canvas);
    border: 1px solid var(--color-border, var(--color-surface-3));
    color: var(--color-text-primary);
    font-size: var(--font-size-telemetry);
    font-family: ui-monospace, monospace;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 140ms var(--ease-standard),
      transform 140ms var(--ease-standard);
    z-index: var(--layer-debug);
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip:hover .tooltip {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
</style>
