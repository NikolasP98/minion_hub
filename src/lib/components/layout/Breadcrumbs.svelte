<script lang="ts" module>
  // Friendly labels for known first-level route segments. Unknown segments
  // fall back to Title Case. A page may override the terminal (last) label by
  // returning `breadcrumb: string` from its load function (read via page.data).
  const SEG_LABEL: Record<string, string> = {
    'my-agent': 'My Agent',
    agents: 'Agents',
    builder: 'Builder',
    workshop: 'Workshop',
    'flow-editor': 'Flows',
    skills: 'Skills',
    tools: 'Tools',
    marketplace: 'Marketplace',
    prompt: 'Prompt',
    studio: 'Studio',
    workforce: 'Workforce',
    reliability: 'Reliability',
    settings: 'Settings',
    sessions: 'Sessions',
    debug: 'Debug',
    users: 'Users',
    'join-requests': 'Join Requests',
    plugins: 'Plugins',
    account: 'Account',
    config: 'Config',
    orgs: 'Organizations',
    shells: 'Shells',
    issues: 'Issues',
    approvals: 'Approvals',
    goals: 'Goals',
    projects: 'Projects',
    org: 'Org',
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

  export type Crumb = { label: string; href: string; current: boolean };

  export function buildCrumbs(pathname: string, terminalOverride?: string): Crumb[] {
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((seg, i) => {
      const href = '/' + segments.slice(0, i + 1).join('/');
      const last = i === segments.length - 1;
      let label = SEG_LABEL[seg] ?? (isOpaqueId(seg) ? decodeURIComponent(seg).slice(0, 12) + '…' : titleCase(seg));
      if (last && terminalOverride) label = terminalOverride;
      return { label, href, current: last };
    });
  }
</script>

<script lang="ts">
  import { page } from '$app/state';
  import { ChevronRight, ChevronLeft } from 'lucide-svelte';

  const terminalOverride = $derived(
    typeof page.data?.breadcrumb === 'string' ? (page.data.breadcrumb as string) : undefined
  );
  const crumbs = $derived(buildCrumbs(page.url.pathname, terminalOverride));
  // Only show on nested routes — top-level pages are already labeled in the sidebar.
  const visible = $derived(crumbs.length >= 2);
  const parentHref = $derived(crumbs.length >= 2 ? crumbs[crumbs.length - 2].href : '/');
</script>

{#if visible}
  <nav
    aria-label="Breadcrumb"
    class="shrink-0 h-7 flex items-center gap-1 px-4 border-b border-[var(--hairline)] bg-bg/60 text-xs"
  >
    <a
      href={parentHref}
      class="flex items-center justify-center w-5 h-5 -ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms]"
      aria-label="Back"
      title="Back"
    >
      <ChevronLeft size={14} />
    </a>
    <ol class="flex items-center gap-1 min-w-0">
      {#each crumbs as crumb, i (crumb.href)}
        {#if i > 0}
          <ChevronRight size={12} class="text-muted-foreground/50 shrink-0" aria-hidden="true" />
        {/if}
        <li class="min-w-0">
          {#if crumb.current}
            <span class="text-foreground font-medium truncate" aria-current="page">{crumb.label}</span>
          {:else}
            <a
              href={crumb.href}
              class="text-muted-foreground hover:text-foreground transition-colors duration-[150ms] truncate"
            >
              {crumb.label}
            </a>
          {/if}
        </li>
      {/each}
    </ol>
  </nav>
{/if}
