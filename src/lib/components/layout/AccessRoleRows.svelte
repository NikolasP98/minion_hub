<script lang="ts" module>
  import { invalidate } from '$lib/navigation';
  import { toastAsync } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';

  export type AccessChoice = 'inherit' | 'allow' | 'deny';
  export type AccessRole = { key: string; name: string };

  /** owner/admin always pass the view check; their row is shown but fixed. */
  export const FIXED_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

  /** Roles + their current choices for `moduleKey` (null = a subject that has no rules yet). */
  export async function loadAccessRows(
    moduleKey: string | null,
  ): Promise<{ roles: AccessRole[]; values: Record<string, AccessChoice> }> {
    const [r, o] = await Promise.all([
      fetch('/api/roles'),
      moduleKey
        ? fetch(`/api/roles/overrides?module=${encodeURIComponent(moduleKey)}`)
        : Promise.resolve(null),
    ]);
    if (!r.ok || (o && !o.ok)) throw new Error('load');
    const catalog = (await r.json()) as { roles: AccessRole[] };
    const rules = o ? ((await o.json()) as Record<string, boolean>) : {};
    return {
      roles: catalog.roles,
      values: Object.fromEntries(
        catalog.roles.map((x) => [
          x.key,
          FIXED_ROLES.has(x.key)
            ? 'allow'
            : !(x.key in rules)
              ? 'inherit'
              : rules[x.key]
                ? 'allow'
                : 'deny',
        ]),
      ),
    };
  }

  /** One role's view rule through /api/roles/overrides (users:manage); throws on a refused write. */
  export async function putAccessRow(moduleKey: string, roleKey: string, next: AccessChoice) {
    const res = await fetch('/api/roles/overrides', {
      method: next === 'inherit' ? 'DELETE' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        next === 'inherit'
          ? { roleKey, module: moduleKey }
          : { roleKey, module: moduleKey, caps: { view: next === 'allow' } },
      ),
    });
    if (!res.ok) throw new Error(String(res.status));
  }

  /** `putAccessRow` with the saving/saved toast and the permission + nav reload; false on failure. */
  export async function saveAccessChoice(
    moduleKey: string,
    roleKey: string,
    next: AccessChoice,
  ): Promise<boolean> {
    try {
      await toastAsync(() => putAccessRow(moduleKey, roleKey, next), {
        loading: m.nav_access_saving(),
        getOutcome: () => ({ type: 'success', title: m.nav_access_saved() }),
        onError: () => ({ title: m.common_error() }),
      });
      await Promise.all([invalidate('app:permissions'), invalidate('app:nav-config')]);
      return true;
    } catch {
      return false;
    }
  }
</script>

<script lang="ts">
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';

  interface Props {
    roles: AccessRole[];
    values: Record<string, AccessChoice>;
    fixed?: ReadonlySet<string>;
    onchange: (roleKey: string, choice: AccessChoice) => void;
    loading?: boolean;
    loadFailed?: boolean;
  }
  let {
    roles,
    values = $bindable(),
    fixed = FIXED_ROLES,
    onchange,
    loading = false,
    loadFailed = false,
  }: Props = $props();
</script>

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
            { value: 'inherit', label: m.nav_access_inherit(), disabled: fixed.has(role.key) },
            { value: 'allow', label: m.nav_access_allow(), disabled: fixed.has(role.key) },
            { value: 'deny', label: m.nav_access_deny(), disabled: fixed.has(role.key) },
          ]}
          onValueChange={(v) => onchange(role.key, v as AccessChoice)}
        />
      </li>
    {/each}
  </ul>
{/if}

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
