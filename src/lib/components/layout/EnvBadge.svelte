<script lang="ts">
  // DEV/PRD backend-mode badge (spec 2026-09-16-hub-minion-run-dev-switcher
  // §2.3). `page.data.env` is set by the root `+layout.server.ts` for every
  // route, including /login, from `locals.backend` (never client-decided).
  //
  // Rendered next to the profile menu in both shells that carry it: Topbar
  // (mobile, < md) and DynamicIsland (desktop, md+, where ProfileMenu
  // actually lives at rest) — a badge that only appeared on the mobile shell
  // would be invisible to the primary desktop audience it's meant to warn.
  import { page } from '$app/state';
  import { Badge, Tooltip } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  type Env = { backend?: 'dev' | 'prd'; local?: boolean } | undefined;
  const env = $derived((page.data as { env?: Env }).env);
  // DEV always shows; PRD shows only for a local server pointed at the
  // production backend (`local && backend === 'prd'`) — never on a deployed
  // environment, where `local` is false.
  const mode = $derived<'dev' | 'prd' | null>(
    env?.backend === 'dev' ? 'dev' : env?.local && env?.backend === 'prd' ? 'prd' : null,
  );
</script>

{#if mode}
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
