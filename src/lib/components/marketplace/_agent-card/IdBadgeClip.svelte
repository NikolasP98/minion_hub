<div class="badge-clip">
  <div class="clip-base"></div>
  <div class="clip-ring"></div>
</div>

<style>
  .badge-clip {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--layer-sticky);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .clip-base {
    width: 36px;
    height: 20px;
    background: linear-gradient(145deg, var(--color-overlay), var(--color-surface-1));
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    border: 1px solid var(--color-border-strong);
    box-shadow: var(--shadow-elevation-1);
  }

  .clip-ring {
    width: 20px;
    height: 8px;
    background: linear-gradient(145deg, var(--color-border-strong), var(--color-surface-3));
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    border: 1px solid var(--color-text-disabled);
    margin-top: -1px;
  }
</style>
