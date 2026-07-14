<script lang="ts">
  import { Button } from '$lib/components/ui';
  /**
   * Compact floating action bar anchored above a selected agent — surfaces the
   * common actions on left-click instead of hiding them behind right-click.
   * "Chat" escalates to the full context menu (it needs the nearby-agent
   * picker); the rest act directly.
   */
  import MessageCircle from 'lucide-svelte/icons/message-circle';
  import Zap from 'lucide-svelte/icons/zap';
  import Footprints from 'lucide-svelte/icons/footprints';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import * as m from '$lib/paraglide/messages';

  let {
    screenX,
    screenY,
    connected,
    behavior,
    onChat,
    onTask,
    onBehavior,
    onDelete,
  }: {
    screenX: number;
    screenY: number;
    connected: boolean;
    behavior: 'stationary' | 'wander' | 'patrol';
    onChat: () => void;
    onTask: () => void;
    onBehavior: () => void;
    onDelete: () => void;
  } = $props();
</script>

<div
  class="absolute z-[var(--layer-dropdown)] pointer-events-auto -translate-x-1/2 flex items-center gap-0.5 p-0.5 rounded-lg border border-border bg-bg2/95 backdrop-blur shadow-lg"
  style="left: {screenX}px; top: {screenY - 46}px;"
>
  <Button
    variant="ghost"
    type="button"
    onclick={onChat}
    title={m.workshop_actionChat()}
    aria-label={m.workshop_actionChat()}
    class="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors"
  >
    <MessageCircle size={14} />
  </Button>
  <Button
    variant="ghost"
    type="button"
    onclick={onTask}
    disabled={!connected}
    title={m.workshop_actionTask()}
    aria-label={m.workshop_actionTask()}
    class="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors disabled:opacity-30 disabled:pointer-events-none"
  >
    <Zap size={14} />
  </Button>
  <Button
    variant="ghost"
    type="button"
    onclick={onBehavior}
    title="{m.workshop_actionBehavior()}: {behavior}"
    aria-label={m.workshop_actionBehavior()}
    class="w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-bg3 {behavior ===
    'stationary'
      ? 'text-muted hover:text-foreground'
      : 'text-accent'}"
  >
    <Footprints size={14} />
  </Button>
  <div class="w-px h-4 bg-border mx-0.5"></div>
  <Button
    variant="ghost"
    type="button"
    onclick={onDelete}
    title={m.workshop_actionDelete()}
    aria-label={m.workshop_actionDelete()}
    class="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-surface)] transition-colors"
  >
    <Trash2 size={14} />
  </Button>
</div>
