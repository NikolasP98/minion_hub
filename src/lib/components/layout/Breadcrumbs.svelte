<script lang="ts" module>
  // Mapping of route segments to message keys for i18n. The actual labels
  // are resolved in the component using message functions.
  const SEG_KEYS: Record<string, keyof typeof import('$lib/paraglide/messages')> = {
    'my-agent': 'breadcrumb_myAgent',
    home: 'nav_home',
    team: 'nav_team',
    capabilities: 'nav_capabilities',
    agents: 'breadcrumb_agents',
    builder: 'breadcrumb_builder',
    workshop: 'breadcrumb_workshop',
    'flow-editor': 'breadcrumb_flowEditor',
    skills: 'breadcrumb_skills',
    tools: 'breadcrumb_tools',
    marketplace: 'breadcrumb_marketplace',
    prompt: 'breadcrumb_prompt',
    studio: 'breadcrumb_studio',
    workforce: 'breadcrumb_workforce',
    reliability: 'breadcrumb_reliability',
    settings: 'breadcrumb_settings',
    sessions: 'breadcrumb_sessions',
    debug: 'breadcrumb_debug',
    users: 'breadcrumb_users',
    'join-requests': 'breadcrumb_joinRequests',
    plugins: 'breadcrumb_plugins',
    account: 'breadcrumb_account',
    config: 'breadcrumb_config',
    orgs: 'breadcrumb_orgs',
    shells: 'breadcrumb_shells',
    issues: 'breadcrumb_issues',
    approvals: 'breadcrumb_approvals',
    goals: 'breadcrumb_goals',
    projects: 'breadcrumb_projects',
    org: 'breadcrumb_org',
  };

  function titleCase(seg: string): string {
    return seg
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Long opaque ids/uuids/slugs read poorly — truncate for display.
  function isOpaqueId(seg: string): boolean {
    return seg.length > 18 || /^[0-9a-f]{8}-/i.test(seg) || /^\d+$/.test(seg);
  }

  export type Crumb = { segment: string; href: string; current: boolean };

  export function buildCrumbs(pathname: string): Crumb[] {
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((seg, i) => {
      const href = '/' + segments.slice(0, i + 1).join('/');
      const last = i === segments.length - 1;
      return { segment: seg, href, current: last };
    });
  }
</script>

<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { ChevronRight, ChevronLeft } from 'lucide-svelte';

  const terminalOverride = $derived(
    typeof page.data?.breadcrumb === 'string' ? (page.data.breadcrumb as string) : undefined
  );
  const crumbs = $derived(buildCrumbs(page.url.pathname));

  function getLabel(segment: string): string {
    if (segment in SEG_KEYS) {
      const key = SEG_KEYS[segment];
      return (m[key] as () => string)?.() ?? segment;
    }
    return isOpaqueId(segment) ? decodeURIComponent(segment).slice(0, 12) + '…' : titleCase(segment);
  }
  // Only show on nested routes — top-level pages are already labeled in the sidebar.
  const visible = $derived(crumbs.length >= 2);
  const parentHref = $derived(crumbs.length >= 2 ? crumbs[crumbs.length - 2].href : '/');
</script>

{#if visible}
  <nav
    aria-label={m.breadcrumb_aria()}
    class="shrink-0 h-7 flex items-center gap-1 px-4 border-b border-[var(--hairline)] bg-bg/60 text-xs"
  >
    <a
      href={parentHref}
      class="flex items-center justify-center w-5 h-5 -ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms]"
      aria-label={m.common_back()}
      title={m.common_back()}
    >
      <ChevronLeft size={14} />
    </a>
    <ol class="flex items-center gap-1 min-w-0">
      {#each crumbs as crumb, i (crumb.href)}
        {@const label = crumb.current && terminalOverride ? terminalOverride : getLabel(crumb.segment)}
        {#if i > 0}
          <ChevronRight size={12} class="text-muted-strong shrink-0" aria-hidden="true" />
        {/if}
        <li class="min-w-0">
          {#if crumb.current}
            <span class="text-foreground font-medium truncate" aria-current="page">{label}</span>
          {:else}
            <a
              href={crumb.href}
              class="text-muted-foreground hover:text-foreground transition-colors duration-[150ms] truncate"
            >
              {label}
            </a>
          {/if}
        </li>
      {/each}
    </ol>
  </nav>
{/if}
