<script lang="ts">
  interface Props {
    phase: 'dormant' | 'awakening' | 'forming' | 'connecting';
    agentName: string;
  }

  let { phase, agentName }: Props = $props();
</script>

<div
  class="orb-field"
  data-phase={phase}
  role="img"
  aria-label={agentName ? `${agentName} agent signal: ${phase}` : `Agent signal: ${phase}`}
>
  <span class="orbit orbit-outer" aria-hidden="true"></span>
  <span class="orbit orbit-inner" aria-hidden="true"></span>
  <span class="orb-core" aria-hidden="true"></span>
  <span class="spark spark-one" aria-hidden="true"></span>
  <span class="spark spark-two" aria-hidden="true"></span>
  <span class="spark spark-three" aria-hidden="true"></span>
  {#if agentName && phase !== 'dormant'}
    <span class="agent-name">{agentName}</span>
  {/if}
</div>

<style>
  .orb-field {
    --orb-scale: 0.7;
    --orb-energy: 0.36;
    position: relative;
    display: grid;
    width: min(13.75rem, 68vw);
    height: min(13.75rem, 68vw);
    place-items: center;
    color: var(--color-accent);
  }

  .orb-field[data-phase='awakening'] {
    --orb-scale: 0.82;
    --orb-energy: 0.56;
  }

  .orb-field[data-phase='forming'] {
    --orb-scale: 0.94;
    --orb-energy: 0.76;
  }

  .orb-field[data-phase='connecting'] {
    --orb-scale: 1;
    --orb-energy: 1;
  }

  .orb-field::before {
    position: absolute;
    width: 72%;
    height: 72%;
    content: '';
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--color-accent) calc(var(--orb-energy) * 28%), transparent),
      transparent 68%
    );
    border-radius: var(--radius-full);
    filter: blur(var(--space-4));
    transform: scale(var(--orb-scale));
    animation: aura-breathe calc(var(--duration-slow) * 8) var(--ease-standard) infinite alternate;
  }

  .orb-core {
    position: relative;
    width: 34%;
    height: 34%;
    background:
      radial-gradient(
        circle at 38% 34%,
        color-mix(in srgb, var(--color-foreground) 88%, transparent),
        transparent 16%
      ),
      radial-gradient(
        circle,
        color-mix(in srgb, var(--color-accent) 90%, var(--color-foreground)),
        color-mix(in srgb, var(--color-accent) 56%, transparent) 58%,
        transparent 72%
      );
    border: 1px solid color-mix(in srgb, var(--color-accent) 62%, transparent);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-status-glow);
    opacity: var(--orb-energy);
    transform: scale(var(--orb-scale));
    animation: core-breathe calc(var(--duration-slow) * 6) var(--ease-spring) infinite alternate;
  }

  .orbit {
    position: absolute;
    border: 1px solid
      color-mix(in srgb, var(--color-accent) calc(var(--orb-energy) * 34%), transparent);
    border-radius: var(--radius-full);
    opacity: var(--orb-energy);
  }

  .orbit-outer {
    width: 70%;
    height: 70%;
    animation: orbit-turn calc(var(--duration-slow) * 24) linear infinite;
  }

  .orbit-inner {
    width: 52%;
    height: 52%;
    border-color: color-mix(
      in srgb,
      var(--color-brand-pink) calc(var(--orb-energy) * 34%),
      transparent
    );
    animation: orbit-turn calc(var(--duration-slow) * 16) linear infinite reverse;
  }

  .orbit::after {
    position: absolute;
    top: calc(-1 * var(--space-1));
    left: 50%;
    width: var(--space-2);
    height: var(--space-2);
    content: '';
    background: currentColor;
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-status-glow);
  }

  .spark {
    position: absolute;
    width: var(--space-1);
    height: var(--space-1);
    background: var(--color-accent);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-status-glow);
    opacity: calc(var(--orb-energy) * 0.8);
    animation: spark-drift calc(var(--duration-slow) * 7) var(--ease-standard) infinite alternate;
  }

  .spark-one {
    top: 24%;
    left: 20%;
  }

  .spark-two {
    right: 18%;
    bottom: 30%;
    animation-delay: calc(-1 * var(--duration-slow));
  }

  .spark-three {
    bottom: 18%;
    left: 34%;
    color: var(--color-brand-pink);
    background: currentColor;
    animation-delay: calc(-2 * var(--duration-slow));
  }

  .agent-name {
    position: absolute;
    bottom: var(--space-2);
    max-width: 90%;
    overflow: hidden;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes core-breathe {
    from {
      transform: scale(calc(var(--orb-scale) * 0.94));
    }
    to {
      transform: scale(calc(var(--orb-scale) * 1.06));
    }
  }

  @keyframes aura-breathe {
    from {
      opacity: 0.56;
      transform: scale(calc(var(--orb-scale) * 0.9));
    }
    to {
      opacity: 1;
      transform: scale(calc(var(--orb-scale) * 1.12));
    }
  }

  @keyframes orbit-turn {
    to {
      transform: rotate(1turn);
    }
  }

  @keyframes spark-drift {
    from {
      transform: translateY(var(--space-2)) scale(0.72);
    }
    to {
      transform: translateY(calc(-1 * var(--space-2))) scale(1.18);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .orb-field::before,
    .orb-core,
    .orbit,
    .spark {
      animation: none;
    }
  }
</style>
