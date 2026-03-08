<script lang="ts">
  import * as toast from '@zag-js/toast';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import { X, Loader2, Info, CircleCheck, CircleAlert, TriangleAlert } from 'lucide-svelte';

  interface Props {
    toast: toast.Options;
    index: number;
    parent: toast.GroupService;
  }

  let { toast: toastProps, index, parent }: Props = $props();

  const machineProps = $derived({ ...toastProps, parent, index });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = useMachine(toast.machine as any, () => machineProps);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = $derived(toast.connect(service as any, normalizeProps));

  const accentColor = $derived.by(() => {
    switch (api.type) {
      case 'error': return 'var(--color-destructive)';
      case 'success': return 'var(--color-success)';
      case 'loading': return 'var(--color-warning)';
      case 'warning': return 'var(--color-warning)';
      default: return 'var(--color-accent)';
    }
  });
</script>

<div
  {...api.getRootProps() as Record<string, unknown>}
  class="toast-item"
  style:--accent={accentColor}
>
  <div class="toast-accent"></div>
  <div class="toast-icon">
    {#if api.type === 'loading'}
      <Loader2 size={16} class="animate-spin" />
    {:else if api.type === 'error'}
      <CircleAlert size={16} />
    {:else if api.type === 'success'}
      <CircleCheck size={16} />
    {:else if api.type === 'warning'}
      <TriangleAlert size={16} />
    {:else}
      <Info size={16} />
    {/if}
  </div>
  <div class="toast-content">
    {#if api.title}
      <p {...api.getTitleProps() as Record<string, unknown>} class="toast-title">{api.title}</p>
    {/if}
    {#if api.description}
      <p {...api.getDescriptionProps() as Record<string, unknown>} class="toast-desc">{api.description}</p>
    {/if}
  </div>
  <button class="toast-close" onclick={api.dismiss} aria-label="Close">
    <X size={14} />
  </button>
</div>

<style>
  .toast-item {
    display: flex;
    align-items: stretch;
    gap: 0;
    min-width: 280px;
    max-width: 380px;
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
  }

  .toast-accent {
    width: 3px;
    flex-shrink: 0;
    background: var(--accent);
  }

  .toast-icon {
    display: flex;
    align-items: center;
    padding: 10px 0 10px 10px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .toast-content {
    flex: 1;
    padding: 10px 8px;
    min-width: 0;
  }

  .toast-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-foreground);
    line-height: 1.3;
  }

  .toast-desc {
    margin: 2px 0 0;
    font-size: 0.75rem;
    color: var(--color-muted-foreground);
    line-height: 1.3;
  }

  .toast-close {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .toast-close:hover {
    color: var(--color-foreground);
  }
</style>
