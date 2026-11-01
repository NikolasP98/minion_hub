<script lang="ts">
  /**
   * "Access…" for a nav page or section (meta spec 037, S5): per role, inherit / allow / deny
   * the view rule stored as a `permission_rules` row keyed `page:<id>` / `page:<pattern>` /
   * `section:<id>`. Writes go through /api/roles/overrides (users:manage, server-validated key).
   * Saves are optimistic per row and roll back on failure.
   */
  import { Dialog } from '$lib/components/ui/foundations';
  import AccessRoleRows, {
    loadAccessRows,
    saveAccessChoice,
    type AccessChoice,
    type AccessRole,
  } from './AccessRoleRows.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    open: boolean;
    subject: { key: string; label: string };
    onclose: () => void;
  }
  let { open = $bindable(), subject, onclose }: Props = $props();

  let roles = $state<AccessRole[]>([]);
  let values = $state<Record<string, AccessChoice>>({});
  let loading = $state(true);
  let loadFailed = $state(false);

  $effect(() => {
    if (!open) return;
    const key = subject.key;
    loading = true;
    loadFailed = false;
    let live = true;
    loadAccessRows(key)
      .then((r) => {
        if (!live) return;
        roles = r.roles;
        values = r.values;
      })
      .catch(() => {
        if (live) loadFailed = true;
      })
      .finally(() => {
        if (live) loading = false;
      });
    return () => (live = false);
  });

  async function save(roleKey: string, next: AccessChoice) {
    const prev = values[roleKey];
    if (next === prev) return;
    values[roleKey] = next;
    if (!(await saveAccessChoice(subject.key, roleKey, next))) values[roleKey] = prev;
  }
</script>

<Dialog bind:open title={m.nav_access_title({ label: subject.label })} size="sm" {onclose}>
  <AccessRoleRows {roles} bind:values {loading} {loadFailed} onchange={(k, v) => void save(k, v)} />
</Dialog>
