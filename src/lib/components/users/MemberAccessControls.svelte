<script lang="ts">
  // Per-user access controls: platform role + org RBAC member-roles chips.
  // Shared by settings/team (TeamTab) and /team People → Access. Owns the
  // member-role mutations; the parent owns the list it patches via `onChange`.
  // TODO(handoff): raw fetch moved verbatim from TeamTab — migrate to
  // `jsonMutation` (see proposals/2026-09-03-hub-team-hr-tabs-followups.md).
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Button, Popover, iconSizes } from '$lib/components/ui';
  import { X, Plus } from 'lucide-svelte';

  type RbacRole = { key: string; name: string; rank: number; description: string | null };

  let {
    userId,
    platformRole,
    memberRoles,
    rbacRoles,
    ownerCount,
    onChange,
    onError,
  }: {
    userId: string;
    platformRole: string | null;
    memberRoles: string[];
    rbacRoles: RbacRole[];
    /** Members holding `owner` org-wide — guards the last-owner removal. */
    ownerCount: number;
    /** Optimistic: called with the next roles before the request, reverted on failure. */
    onChange: (roles: string[]) => void;
    onError: (message: string) => void;
  } = $props();

  async function addRole(roleKey: string) {
    const prev = memberRoles;
    if (prev.includes(roleKey)) return;
    onChange([...prev, roleKey]);
    try {
      const res = await fetch(`/api/users/${userId}/member-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleKey }),
      });
      if (!res.ok) throw new Error(String(res.status));
      void invalidate('settings:team');
    } catch {
      onChange(prev);
      onError(m.users_errorAddRole({ status: 'unknown' }));
    }
  }

  async function removeRole(roleKey: string) {
    const prev = memberRoles;
    onChange(prev.filter((r) => r !== roleKey));
    try {
      const res = await fetch(`/api/users/${userId}/member-role`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleKey }),
      });
      if (!res.ok) throw new Error(String(res.status));
      void invalidate('settings:team');
    } catch {
      onChange(prev);
      onError(m.users_errorRemoveRole({ status: 'unknown' }));
    }
  }
</script>

{#if platformRole === 'admin'}
  <span
    class="inline-flex items-center h-6 px-2 rounded-md text-[length:var(--font-size-telemetry)] font-semibold border bg-bg3 border-border text-muted-foreground"
    title="Platform admin — full access"
  >
    {m.users_role()}: admin
  </span>
{:else}
  <div class="flex items-center gap-1 flex-wrap">
    {#each memberRoles as roleKey (roleKey)}
      {@const roleName = rbacRoles.find((r) => r.key === roleKey)?.name ?? roleKey}
      {@const lastOwner = roleKey === 'owner' && ownerCount <= 1}
      <span
        class="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md text-[length:var(--font-size-telemetry)] font-semibold border bg-accent/10 text-foreground border-accent/30"
      >
        {roleName}
        <Button
          variant="ghost"
          size="xs"
          type="button"
          aria-label={`Remove ${roleName}`}
          disabled={lastOwner}
          title={lastOwner ? m.users_cannotRemoveLastOwner() : undefined}
          class="flex items-center justify-center w-3.5 h-3.5 rounded-sm hover:bg-bg3 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          onclick={() => removeRole(roleKey)}
        >
          <X size={iconSizes.xs} />
        </Button>
      </span>
    {/each}
    {#if rbacRoles.some((r) => !memberRoles.includes(r.key))}
      <Popover placement="bottom" bare>
        {#snippet trigger()}
          <span
            class="inline-flex items-center gap-0.5 h-6 px-1.5 rounded-md text-[length:var(--font-size-telemetry)] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-[var(--color-border-strong)] transition-colors"
            title={m.users_addRole()}
          >
            <Plus size={iconSizes.xs} />
          </span>
        {/snippet}
        <div
          role="listbox"
          class="min-w-[140px] max-h-[240px] overflow-y-auto rounded-lg border border-border bg-bg2 shadow-[var(--shadow-overlay)] p-1"
        >
          {#each rbacRoles.filter((r) => !memberRoles.includes(r.key)) as r (r.key)}
            <Button
              variant="ghost"
              size="xs"
              type="button"
              role="option"
              aria-selected="false"
              class="flex items-center w-full gap-2 px-2 py-1.5 rounded text-[length:var(--font-size-label)] cursor-pointer transition-colors text-muted-foreground hover:text-foreground hover:bg-bg3"
              onclick={() => addRole(r.key)}
            >
              {r.name}
            </Button>
          {/each}
        </div>
      </Popover>
    {/if}
  </div>
{/if}
