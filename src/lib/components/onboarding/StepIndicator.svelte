<script lang="ts">
  interface Props { step: number; totalSteps: number; }
  let { step, totalSteps }: Props = $props();
  const labels = ['Awaken', 'Remember', 'Connect'];
</script>

<div class="step-indicator">
  {#each Array(totalSteps) as _, i}
    <div class="step-dot" class:active={i + 1 === step} class:done={i + 1 < step}>
      <span class="dot"></span>
      <span class="label">{labels[i]}</span>
    </div>
    {#if i < totalSteps - 1}
      <div class="connector" class:filled={i + 1 < step}></div>
    {/if}
  {/each}
</div>

<style>
  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin-bottom: 2rem;
  }
  .step-dot { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }
  .dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--color-bg3);
    border: 2px solid var(--color-border);
    transition: all var(--duration-normal) var(--ease-standard);
  }
  .active .dot {
    background: var(--color-accent);
    border-color: var(--color-accent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--color-accent) 50%, transparent);
    transform: scale(1.3);
  }
  .done .dot { background: var(--color-accent); border-color: var(--color-accent); }
  .label {
    font-size: 0.65rem; font-weight: 500;
    color: var(--color-muted-foreground);
    text-transform: uppercase; letter-spacing: 0.05em;
    transition: color var(--duration-fast);
  }
  .active .label, .done .label { color: var(--color-muted); }
  .connector {
    width: 48px; height: 2px;
    background: var(--hairline);
    margin: 0 4px; margin-bottom: 1.2rem;
    transition: background var(--duration-normal);
  }
  .connector.filled { background: color-mix(in srgb, var(--color-accent) 40%, transparent); }
</style>