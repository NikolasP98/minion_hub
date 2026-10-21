import type { ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
import type { DropdownItem } from '$lib/components/ui/Dropdown.svelte';
import { MoreHorizontal } from 'lucide-svelte';
export interface RecordAction extends ContextMenuItem {
  run?: () => void | Promise<unknown>;
  children?: RecordAction[];
}
/** Adapt an existing kebab catalog; keep its permissions, icons and handlers. */
export function recordActions(items: DropdownItem[], select: (id: string) => void): RecordAction[] {
  return items
    .filter((item) => !item.divider)
    .map((item) => ({
      id: item.value,
      label: item.label,
      icon: item.icon ?? MoreHorizontal,
      disabled: item.disabled,
      danger: item.danger,
      run: () => select(item.value),
    }));
}
export function findRecordAction(actions: RecordAction[], id: string): RecordAction | undefined {
  for (const action of actions) {
    if (action.id === id) return action;
    const child = action.children && findRecordAction(action.children, id);
    if (child) return child;
  }
}
