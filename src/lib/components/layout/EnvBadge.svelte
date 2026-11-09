<script lang="ts">
  // DEV/PRD backend-mode badge (spec 2026-09-16-hub-minion-run-dev-switcher
  // §2.3). `page.data.env` is set by the root `+layout.server.ts` for every
  // route, including /login, from `locals.backend` (never client-decided).
  //
  // Rendered next to the profile menu in both shells that carry it: Topbar
  // (mobile, < md) and SidebarUtilities (desktop, md+, where ProfileMenu
  // actually lives at rest) — a badge that only appeared on the mobile shell
  // would be invisible to the primary desktop audience it's meant to warn.
  import { page } from '$app/state';
  import { Badge, Dropdown, Tooltip } from '$lib/components/ui';
  import { Users } from 'lucide-svelte';
  import DevUserSwitcher from './DevUserSwitcher.svelte';
  import type { RoleSimulationState } from '$lib/role-simulation';
  import * as m from '$lib/paraglide/messages';

  type Env = { backend?: 'dev' | 'prd'; local?: boolean } | undefined;
  const env = $derived((page.data as { env?: Env }).env);
  // DEV always shows; PRD shows only for a local server pointed at the
  // production backend (`local && backend === 'prd'`) — never on a deployed
  // environment, where `local` is false.
  const mode = $derived<'dev' | 'prd' | null>(
    env?.backend === 'dev' ? 'dev' : env?.local && env?.backend === 'prd' ? 'prd' : null,
  );
  const user = $derived((page.data as { user?: { id: string } | null }).user);
  const simulationActive = $derived(
    (page.data as { roleSimulation?: RoleSimulationState }).roleSimulation?.active === true,
  );
  const canSwitchAccount = $derived(mode === 'dev' && !!user && !simulationActive);
  let accountSwitcherOpen = $state(false);
</script>

{#if canSwitchAccount}
  <Dropdown
    placement="top"
    items={[{ value: 'qa-account', label: m.profile_switch_user(), icon: Users }]}
    onSelect={() => {
      accountSwitcherOpen = true;
    }}
  >
    {#snippet trigger()}
      <span class="qa-tools-trigger">
        <span class="sr-only">{m.env_badge_qa_tools()}</span>
        <Badge variant="semantic" value="accent" size="sm" class="uppercase tracking-wide">
          {m.env_badge_dev()}
        </Badge>
      </span>
    {/snippet}
  </Dropdown>
  <DevUserSwitcher bind:open={accountSwitcherOpen} currentUserId={user?.id ?? null} />
{:else if mode}
  <Tooltip id="env-badge" placement="bottom" openDelay={150} closeDelay={80}>
    <Badge
      variant="semantic"
      value={mode === 'dev' ? 'accent' : 'error'}
      size="sm"
      class="uppercase tracking-wide"
    >
      {mode === 'dev' ? m.env_badge_dev() : m.env_badge_prd()}
    </Badge>
    {#snippet content()}
      {mode === 'dev' ? m.env_badge_dev_hint() : m.env_badge_prd_hint()}
    {/snippet}
  </Tooltip>
{/if}

<style>
  .qa-tools-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--control-height-touch);
    min-width: var(--control-height-touch);
  }
</style>
