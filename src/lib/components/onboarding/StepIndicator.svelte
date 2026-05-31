<script lang="ts">
  interface Props {
    step: number;
    totalSteps: number;
  }
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

  .step-dot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    border: 2px solid rgba(255, 255, 255, 0.1);
    transition: all 0.4s ease;
  }

  .active .dot {
    background: #818cf8;
    border-color: #6366f1;
    box-shadow: 0 0 12px rgba(99, 102, 241, 0.5);
    transform: scale(1.3);
  }

  .done .dot {
    background: #6366f1;
    border-color: #6366f1;
  }

  .label {
    font-size: 0.65rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: color 0.3s;
  }

  .active .label, .done .label {
    color: rgba(255, 255, 255, 0.7);
  }

  .connector {
    width: 48px;
    height: 2px;
    background: rgba(255, 255, 255, 0.08);
    margin: 0 4px;
    margin-bottom: 1.2rem;
    transition: background 0.4s;
  }

  .connector.filled {
    background: rgba(99, 102, 241, 0.4);
  }
</style>