<script lang="ts">
  interface Props {
    step: number;
    totalSteps: number;
  }
  let { step, totalSteps }: Props = $props();
  const labels = ['Awaken', 'Remember', 'Connect'];
</script>

<ol class="step-indicator" aria-label="Onboarding progress">
  {#each Array(totalSteps) as _, i}
    <li
      class="step-dot"
      class:active={i + 1 === step}
      class:done={i + 1 < step}
      aria-current={i + 1 === step ? 'step' : undefined}
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="label">{labels[i]}</span>
    </li>
  {/each}
</ol>

<style>
  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-6);
    padding: 0;
    list-style: none;
  }
  .step-dot {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .step-dot:not(:last-child)::after {
    position: absolute;
    top: calc(var(--space-3) / 2);
    left: calc(50% + var(--space-3));
    width: calc(100% - var(--space-3));
    height: 2px;
    content: '';
    background: var(--hairline);
    transition: background var(--duration-normal) var(--ease-standard);
  }
  .step-dot.done:not(:last-child)::after {
    background: color-mix(in srgb, var(--color-accent) 44%, transparent);
  }
  .dot {
    position: relative;
    z-index: var(--layer-base);
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-full);
    background: var(--color-bg3);
    border: 2px solid var(--color-border);
    transition:
      transform var(--duration-normal) var(--ease-standard),
      background var(--duration-normal) var(--ease-standard),
      border-color var(--duration-normal) var(--ease-standard),
      box-shadow var(--duration-normal) var(--ease-standard);
  }
  .active .dot {
    background: var(--color-accent);
    border-color: var(--color-accent);
    box-shadow: var(--shadow-status-glow);
    color: var(--color-accent);
    transform: scale(1.3);
  }
  .done .dot {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .label {
    overflow: hidden;
    max-width: 100%;
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-medium);
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: var(--letter-spacing-label);
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--duration-fast) var(--ease-standard);
  }
  .active .label,
  .done .label {
    color: var(--color-muted);
  }
</style>
