<script lang="ts">
  import * as toast from '@zag-js/toast';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import { X, Loader2, Info, CircleCheck, CircleAlert, TriangleAlert } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

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
  data-type={api.type}
  style:--toast-accent={accentColor}
>
  <div {...api.getGhostBeforeProps() as Record<string, unknown>}></div>
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
  <Button variant="ghost" size="xs"
    {...api.getCloseTriggerProps() as Record<string, unknown>}
    class="toast-close"
    aria-label={m.common_close()}
  >
    <X size={14} />
  </Button>
  <div {...api.getGhostAfterProps() as Record<string, unknown>}></div>
</div>

<style>
  .toast-item {
    position: absolute;
    right: 0;
    display: flex;
    align-items: stretch;
    gap: 0;
    min-width: 280px;
    max-width: 380px;
    background: var(--elevation-4-bg);
    border: 1px solid var(--elevation-4-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-lg);
    pointer-events: auto;

    /* Zag-driven positioning and motion */
    transform: translateY(var(--y, 0));
    opacity: var(--opacity, 1);
    z-index: var(--z-index, 1);
    height: var(--height, auto);
    transition:
      transform var(--duration-normal) var(--ease-spring),
      opacity var(--duration-fast) var(--ease-in),
      height var(--duration-normal) var(--ease-out);
  }

  /* Severity emphasis — error/warning read louder than info/success */
  .toast-item[data-type='error'],
  .toast-item[data-type='warning'] {
    border-color: color-mix(in srgb, var(--toast-accent) 38%, var(--elevation-4-border));
    background: color-mix(in srgb, var(--toast-accent) 8%, var(--elevation-4-bg));
  }

  .toast-accent {
    width: 3px;
    flex-shrink: 0;
    background: var(--toast-accent);
  }

  .toast-icon {
    display: flex;
    align-items: center;
    padding: var(--space-3) 0 var(--space-3) var(--space-3);
    color: var(--toast-accent);
    flex-shrink: 0;
  }

  .toast-content {
    flex: 1;
    padding: var(--space-3) var(--space-2);
    min-width: 0;
  }

  .toast-title {
    margin: 0;
    font-size: var(--font-size-body);
    font-weight: 600;
    color: var(--color-foreground);
    line-height: 1.3;
  }

  .toast-desc {
    margin: var(--space-0-5) 0 0;
    font-size: var(--font-size-label);
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
    transition: color var(--duration-fast) var(--ease-out);
  }
  .toast-close:hover {
    color: var(--color-foreground);
  }
</style>
