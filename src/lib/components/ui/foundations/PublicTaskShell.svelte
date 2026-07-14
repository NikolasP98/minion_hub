<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type PublicTaskShellSize = 'narrow' | 'medium' | 'wide';
  export type PublicTaskShellTone = 'default' | 'success' | 'warning' | 'danger';

  export interface PublicTaskShellProps {
    eyebrow: string;
    title: string;
    description?: string;
    size?: PublicTaskShellSize;
    tone?: PublicTaskShellTone;
    icon?: Snippet;
    hero?: Snippet;
    children: Snippet;
    footer?: Snippet;
  }
</script>

<script lang="ts">
  let {
    eyebrow,
    title,
    description,
    size = 'narrow',
    tone = 'default',
    icon,
    hero,
    children,
    footer,
  }: PublicTaskShellProps = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
</script>

<main class="public-task-scroll">
  <div class="ambient ambient-primary" aria-hidden="true"></div>
  <div class="ambient ambient-secondary" aria-hidden="true"></div>
  <div class="signal-grid" aria-hidden="true"></div>

  <div class="task-stage" data-size={size}>
    {#if hero}
      <div class="task-hero">{@render hero()}</div>
    {/if}

    <section class="task-panel" data-tone={tone} aria-labelledby={titleId}>
      <div class="task-chrome" aria-hidden="true">
        <div class="wordmark">
          <span class="wordmark-minion">Minion</span>
          <span class="wordmark-hub">Hub</span>
        </div>
        <span class="task-eyebrow">{eyebrow}</span>
        <span class="signal-lights">
          <span data-signal="danger"></span>
          <span data-signal="warning"></span>
          <span data-signal="success"></span>
        </span>
      </div>

      <div class="task-inner">
        <header class="task-heading">
          {#if icon}
            <span class="task-icon" aria-hidden="true">{@render icon()}</span>
          {/if}
          <div class="task-copy">
            <h1 id={titleId}>{title}</h1>
            {#if description}<p>{description}</p>{/if}
          </div>
        </header>

        <div class="task-content">{@render children()}</div>

        {#if footer}
          <footer class="task-footer">{@render footer()}</footer>
        {/if}
      </div>
    </section>
  </div>
</main>

<style>
  .public-task-scroll {
    position: relative;
    z-index: var(--layer-base);
    display: grid;
    min-height: 100vh;
    height: 100dvh;
    overflow-x: hidden;
    overflow-y: auto;
    place-items: center;
    padding: max(var(--space-8), env(safe-area-inset-top, 0px))
      max(var(--space-page-gutter), env(safe-area-inset-right, 0px))
      max(var(--space-8), env(safe-area-inset-bottom, 0px))
      max(var(--space-page-gutter), env(safe-area-inset-left, 0px));
    isolation: isolate;
  }

  .task-stage {
    position: relative;
    z-index: var(--layer-base);
    display: grid;
    width: 100%;
    gap: var(--space-6);
  }

  .task-stage[data-size='narrow'] {
    max-width: 26rem;
  }

  .task-stage[data-size='medium'] {
    max-width: 32rem;
  }

  .task-stage[data-size='wide'] {
    max-width: 46rem;
  }

  .task-hero {
    display: grid;
    place-items: center;
    min-width: 0;
  }

  .task-panel {
    position: relative;
    overflow: hidden;
    width: 100%;
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--elevation-2-bg) 94%, transparent);
    border: 1px solid var(--elevation-2-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-overlay);
    backdrop-filter: blur(var(--space-4));
    animation: task-arrive var(--duration-slow) var(--ease-enter) both;
  }

  .task-panel[data-tone='success'] {
    border-color: color-mix(in srgb, var(--color-success) 42%, var(--elevation-2-border));
  }

  .task-panel[data-tone='warning'] {
    border-color: color-mix(in srgb, var(--color-warning) 42%, var(--elevation-2-border));
  }

  .task-panel[data-tone='danger'] {
    border-color: color-mix(in srgb, var(--color-destructive) 42%, var(--elevation-2-border));
  }

  .task-chrome {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    min-height: var(--control-height-touch);
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: color-mix(in srgb, var(--color-bg) 58%, transparent);
    border-bottom: 1px solid var(--hairline);
  }

  .wordmark {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-display);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-bold);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .wordmark-minion {
    padding: var(--space-0-5) var(--space-2);
    color: var(--color-canvas);
    background: var(--color-brand-pink);
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }

  .wordmark-hub {
    padding: var(--space-0-5) var(--space-1);
    color: var(--color-foreground);
  }

  .task-eyebrow {
    min-width: 0;
    overflow: hidden;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    letter-spacing: var(--letter-spacing-label);
    text-align: center;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .signal-lights {
    display: inline-flex;
    gap: var(--space-1);
  }

  .signal-lights span {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    opacity: 0.72;
  }

  [data-signal='danger'] {
    background: var(--color-destructive);
  }

  [data-signal='warning'] {
    background: var(--color-warning);
  }

  [data-signal='success'] {
    background: var(--color-success);
  }

  .task-inner {
    display: grid;
    gap: var(--space-6);
    padding: var(--space-6);
  }

  .task-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .task-icon {
    display: inline-grid;
    flex: 0 0 auto;
    width: var(--control-height-touch);
    height: var(--control-height-touch);
    place-items: center;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 24%, transparent);
    border-radius: var(--radius-lg);
  }

  .task-copy {
    min-width: 0;
  }

  h1 {
    margin: 0;
    color: var(--color-foreground);
    font-family: var(--font-display);
    font-size: var(--font-size-page-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-display);
  }

  .task-copy p {
    margin: var(--space-1) 0 0;
    color: var(--color-muted-foreground);
    font-size: var(--font-size-body);
    line-height: var(--line-height-body);
  }

  .task-content {
    min-width: 0;
  }

  .task-footer {
    padding-top: var(--space-4);
    color: var(--color-muted-foreground);
    border-top: 1px solid var(--hairline);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
    text-align: center;
  }

  .ambient,
  .signal-grid {
    position: fixed;
    z-index: var(--layer-base);
    pointer-events: none;
  }

  .ambient {
    width: min(46rem, 84vw);
    height: min(46rem, 84vw);
    border-radius: var(--radius-full);
    filter: blur(var(--space-12));
    opacity: 0.18;
  }

  .ambient-primary {
    top: -24%;
    right: -16%;
    background: var(--color-accent);
  }

  .ambient-secondary {
    bottom: -30%;
    left: -18%;
    background: var(--color-brand-pink);
  }

  .signal-grid {
    inset: 0;
    background-image:
      linear-gradient(
        color-mix(in srgb, var(--color-border) 40%, transparent) 1px,
        transparent 1px
      ),
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--color-border) 40%, transparent) 1px,
        transparent 1px
      );
    background-size: var(--space-12) var(--space-12);
    mask-image: linear-gradient(to bottom, transparent, currentColor 32%, transparent);
    opacity: 0.18;
  }

  @keyframes task-arrive {
    from {
      opacity: 0;
      transform: translateY(var(--space-2)) scale(0.99);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 479.98px) {
    .public-task-scroll {
      place-items: start center;
      padding-top: max(var(--space-4), env(safe-area-inset-top, 0px));
      padding-bottom: max(var(--space-4), env(safe-area-inset-bottom, 0px));
    }

    .task-inner {
      gap: var(--space-4);
      padding: var(--space-4);
    }

    .task-chrome {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .signal-lights {
      display: none;
    }

    .task-heading {
      align-items: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .task-panel {
      animation: none;
    }
  }
</style>
