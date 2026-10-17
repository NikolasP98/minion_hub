<script lang="ts">
  /**
   * One ring that changes behaviour instead of four icons that swap places
   * (SmoothUI `ai-tool-call`, MIT): queued breathes, running spins as a gap in
   * the same ring, done keeps the ring and draws a check, failed draws a cross.
   * The ring never unmounts, so the eye tracks one object through the lifecycle.
   */
  import { iconSizes } from '$lib/components/ui';
  import type { AIToolStatus } from './ai-state';

  const { status, size = iconSizes.md }: { status: AIToolStatus; size?: number } = $props();
</script>

<svg
  class="status-ring"
  data-status={status}
  viewBox="0 0 24 24"
  width={size}
  height={size}
  aria-hidden="true"
>
  <g class="spin">
    <circle
      cx="12"
      cy="12"
      r="8"
      pathLength="1"
      fill="none"
      stroke-width="2"
      stroke-linecap="round"
    />
  </g>
  {#if status === 'success'}
    <path class="mark" d="M 8.5 12.2 L 11 14.8 L 15.8 9.6" pathLength="1" />
  {:else if status === 'error'}
    <path class="mark" d="M 9 9 L 15 15" pathLength="1" />
    <path class="mark second" d="M 15 9 L 9 15" pathLength="1" />
  {/if}
</svg>

<style>
  .status-ring {
    flex-shrink: 0;
    overflow: visible;
    color: var(--color-text-tertiary);
  }
  .status-ring[data-status='success'] {
    color: var(--color-success-fg);
  }
  .status-ring[data-status='error'] {
    color: var(--color-danger-fg);
  }
  circle {
    stroke: currentColor;
    stroke-dasharray: 1 0;
    transition:
      stroke-dasharray var(--duration-normal) var(--ease-standard),
      stroke var(--duration-normal) var(--ease-standard);
  }
  .spin {
    transform-box: view-box;
    transform-origin: center;
  }
  /* Running opens a gap in the ring and turns it. */
  .status-ring[data-status='running'] circle {
    stroke-dasharray: 0.68 0.32;
  }
  .status-ring[data-status='running'] .spin {
    animation: ai-ring-spin calc(var(--duration-slow) * 2.25) linear infinite;
  }
  .status-ring[data-status='pending'] circle {
    animation: ai-ring-breathe calc(var(--duration-slow) * 4) ease-in-out infinite;
  }
  .mark {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
    animation: ai-ring-draw var(--duration-normal) var(--ease-standard) both;
  }
  .mark.second {
    animation-delay: calc(var(--duration-instant) * 0.8);
  }
  @keyframes ai-ring-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes ai-ring-breathe {
    0%,
    100% {
      stroke-opacity: 0.35;
    }
    50% {
      stroke-opacity: 1;
    }
  }
  @keyframes ai-ring-draw {
    from {
      stroke-dashoffset: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-ring[data-status='running'] .spin,
    .status-ring[data-status='pending'] circle,
    .mark {
      animation: none;
    }
  }
</style>
