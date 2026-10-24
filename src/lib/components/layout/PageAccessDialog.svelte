<script lang="ts">
  /**
   * "Access…" for a nav page or section (meta spec 037, S5): per role, inherit / allow / deny
   * the view rule stored as a `permission_rules` row keyed `page:<id>` / `page:<pattern>` /
   * `section:<id>`. Writes go through /api/roles/overrides (users:manage, server-validated key).
   * Saves are optimistic per row and roll back on failure.
   */
  import { Dialog } from '$lib/components/ui/foundations';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import { invalidate } from '$lib/navigation';
  import { toastAsync } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';

  type Choice = 'inherit' | 'allow' | 'deny';
  interface Props {
    open: boolean;
    subject: { key: string; label: string };
    onclose: () => void;
  }
  let { open = $bindable(), subject, onclose }: Props = $props();

  /** owner/admin always pass the view check; their row is shown but fixed. */
  const FIXED = new Set(['owner', 'admin']);

  let roles = $state<{ key: string; name: string }[]>([]);
  let values = $state<Record<string, Choice>>({});
  let loading = $state(true);
  let loadFailed = $state(false);

  $effect(() => {
    if (!open) return;
    const key = subject.key;
    loading = true;
    loadFailed = false;
    let live = true;
    (async () => {
      try {
        const [r, o] = await Promise.all([
          fetch('/api/roles'),
          fetch(`/api/roles/overrides?module=${encodeURIComponent(key)}`),
        ]);
        if (!r.ok || !o.ok) throw new Error('load');
        const catalog = (await r.json()) as { roles: { key: string; name: string }[] };
        const rules = (await o.json()) as Record<string, boolean>;
        if (!live) return;
        roles = catalog.roles;
        values = Object.fromEntries(
          catalog.roles.map((x) => [
            x.key,
            FIXED.has(x.key)
              ? 'allow'
              : !(x.key in rules)
                ? 'inherit'
                : rules[x.key]
                  ? 'allow'
                  : 'deny',
          ]),
        );
      } catch {
        if (live) loadFailed = true;
      } finally {
        if (live) loading = false;
      }
    })();
    return () => (live = false);
  });

  async function save(roleKey: string, next: Choice) {
    const prev = values[roleKey];
    if (next === prev) return;
    values[roleKey] = next;
    const send = async () => {
      const res = await fetch('/api/roles/overrides', {
        method: next === 'inherit' ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          next === 'inherit'
            ? { roleKey, module: subject.key }
            : { roleKey, module: subject.key, caps: { view: next === 'allow' } },
        ),
      });
      if (!res.ok) throw new Error(String(res.status));
    };
    try {
      await toastAsync(send, {
        loading: m.nav_access_saving(),
        getOutcome: () => ({ type: 'success', title: m.nav_access_saved() }),
        onError: () => ({ title: m.common_error() }),
      });
      await Promise.all([invalidate('app:permissions'), invalidate('app:nav-config')]);
    } catch {
      values[roleKey] = prev;
    }
  }
</script>

<Dialog bind:open title={m.nav_access_title({ label: subject.label })} size="sm" {onclose}>
  {#if loading}
    <p class="access-note">{m.common_loading()}</p>
  {:else if loadFailed}
    <p class="access-note" role="alert">{m.common_error()}</p>
  {:else}
    <p class="access-note">{m.nav_access_inherit_hint()}</p>
    <ul class="access-rows">
      {#each roles as role (role.key)}
        <li class="access-row">
          <span class="access-role">{role.name}</span>
          <SegmentedControl
            aria-label={role.name}
            value={values[role.key]}
            items={[
              { value: 'inherit', label: m.nav_access_inherit(), disabled: FIXED.has(role.key) },
              { value: 'allow', label: m.nav_access_allow(), disabled: FIXED.has(role.key) },
              { value: 'deny', label: m.nav_access_deny(), disabled: FIXED.has(role.key) },
            ]}
            onValueChange={(v) => void save(role.key, v as Choice)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</Dialog>

<style>
  .access-note {
    color: var(--color-muted-foreground);
    font-size: var(--font-size-body);
    margin-bottom: var(--space-3);
  }
  .access-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .access-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .access-role {
    font-size: var(--font-size-body);
    color: var(--color-foreground);
  }
</style>
