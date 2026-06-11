<script lang="ts">
  import * as menu from '@zag-js/menu';
  import { useMachine, normalizeProps } from '@zag-js/svelte';
  import { Eye, Pencil } from 'lucide-svelte';
  import { Modal } from '$lib/components/ui';
  import UserAvatar from './UserAvatar.svelte';
  import AvatarEditorModal from './avatar/AvatarEditorModal.svelte';

  let nextId = 0;
  const menuId = `avatar-menu-${nextId++}`;

  let {
    userId,
    name,
    email,
    src,
    size = 88,
  }: {
    userId: string;
    name: string | null;
    email: string | null;
    src: string | null;
    size?: number;
  } = $props();

  let editing = $state(false);
  let viewing = $state(false);

  const service = useMachine(menu.machine as any, () => ({
    id: menuId,
    positioning: { placement: 'bottom-start' as const },
    onSelect({ value }: { value: string }) {
      if (value === 'view') viewing = true;
      else if (value === 'edit') editing = true;
    },
  }));
  const api = $derived(menu.connect(service as any, normalizeProps));
</script>

<button
  {...api.getTriggerProps()}
  class="relative group rounded-full bg-transparent border-none p-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg2"
  aria-label="Avatar options"
>
  <UserAvatar {name} {email} {src} {size} />
  <span
    class="absolute inset-0 rounded-full bg-black/40 grid place-items-center opacity-0 group-hover:opacity-100 group-data-[state=open]:opacity-100 transition-opacity"
  >
    <Pencil size={Math.round(size * 0.22)} class="text-white" />
  </span>
</button>

<div {...api.getPositionerProps()} class="z-50">
  <div
    {...api.getContentProps()}
    class="min-w-36 rounded-[var(--radius-md)] surface-4 border border-[var(--elevation-4-border)] p-1 shadow-xl outline-none"
  >
    <button
      {...api.getItemProps({ value: 'view' })}
      class="flex w-full items-center gap-2 px-2.5 py-1.5 rounded text-sm text-foreground data-[highlighted]:bg-white/[0.06] cursor-pointer bg-transparent border-none text-left"
    >
      <Eye size={14} class="text-muted-foreground" /> View
    </button>
    <button
      {...api.getItemProps({ value: 'edit' })}
      class="flex w-full items-center gap-2 px-2.5 py-1.5 rounded text-sm text-foreground data-[highlighted]:bg-white/[0.06] cursor-pointer bg-transparent border-none text-left"
    >
      <Pencil size={14} class="text-muted-foreground" /> Edit
    </button>
  </div>
</div>

<!-- View: enlarged avatar -->
<Modal bind:open={viewing} title={name ?? email ?? 'Avatar'} size="sm">
  <div class="grid place-items-center py-2">
    <UserAvatar {name} {email} {src} size={240} />
  </div>
</Modal>

<AvatarEditorModal bind:open={editing} {userId} {name} {email} {src} />
