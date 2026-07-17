<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto, afterNavigate } from '$lib/navigation';
  import { page } from '$app/state';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import ParticleCanvas from '$lib/components/layout/ParticleCanvas.svelte';
  import BgPattern from '$lib/components/decorations/BgPattern.svelte';
  import { theme, applyTheme } from '$lib/state/ui/theme.svelte';
  import { bugReporter } from '$lib/state/ui/bug-reporter.svelte';
  import { crtConfig } from '$lib/state/ui/crt-config.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { loadHosts, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { userState } from '$lib/state/features/user.svelte';
  import { type Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import { locale } from '$lib/state/ui/locale.svelte';
  import { loadAndApplyServerPreferences } from '$lib/state/ui/preference-sync.svelte';
  import { installInterceptor } from '$lib/utils/console-interceptor';

  // Vercel telemetry (analytics + speed insights) is injected lazily from
  // +layout.ts — it was previously ALSO injected here, double-loading the
  // analytics script eagerly in the shell bundle.

  // `data` (LayoutData) is consumed via `page.data` getters in userState; we
  // don't need it directly in this component.
  let { children }: { data: LayoutData; children: Snippet } = $props();

  const isVoxelized = $derived(theme.preset.id === 'voxelized');

  // Deferred shell chrome (Toaster, HostsOverlay): mounted after first idle so
  // their chunks — and the paraglide messages chunk they pull — stay off the
  // boot-critical path. Toasts fired before mount queue in the zag store.
  let idleReady = $state(false);

  // userState now derives from `page.data` via getters — no rune hydration
  // needed. Server load + `invalidate('app:user')` is the single refresh path.

  // Manual PostHog pageview capture. We disabled the default history-patch
  // capture (`capture_pageview: false` in hooks.client.ts) to silence the
  // SvelteKit "Avoid using history.pushState(...)" router warning.
  if (!import.meta.env.VITE_DESKTOP) {
    afterNavigate(() => {
      const ph = (
        window as Window & {
          posthog?: { capture: (e: string, p?: Record<string, unknown>) => void };
        }
      ).posthog;
      ph?.capture('$pageview');
    });
  }

  onMount(async () => {
    installInterceptor();

    const markIdle = () => (idleReady = true);
    if ('requestIdleCallback' in window) requestIdleCallback(markIdle, { timeout: 1500 });
    else setTimeout(markIdle, 300);

    const current = canonicalPath(page.url.pathname);
    // Public auth-flow pages (sign-in, forgot-password, recovery-link
    // landing) must render for a signed-out visitor — mirrors the
    // UNPROTECTED_PREFIXES SSR gate in hooks.server.ts. Without this
    // exemption, `/login/forgot` and `/auth/reset` would bounce straight
    // back to `/login` before the user can use them.
    const isPublicAuthPage =
      current === '/login' ||
      current.startsWith('/login/') ||
      current.startsWith('/auth/') ||
      current.startsWith('/book/') ||
      current === '/invite/accept';

    if (!userState.user) {
      if (!isPublicAuthPage) {
        const redirectParam = current !== '/' ? `?redirectTo=${encodeURIComponent(current)}` : '';
        goto(`/login${redirectParam}`, { replaceState: true });
      }
      return;
    }

    // Independent server calls — sequential awaits here cost a full serial
    // RTT each before the gateway WS could even start connecting.
    await Promise.all([loadAndApplyServerPreferences(), loadHosts()]);
    if (hostsState.activeHostId) wsConnect();
  });

  $effect(() => {
    applyTheme(theme.preset, theme.accent.value);
  });

  $effect(() => {
    if (theme.preset.id === 'crt') {
      crtConfig.apply();
    } else {
      crtConfig.cleanup();
    }
  });
</script>

<ParaglideJS {i18n} languageTag={locale.current}>
  {#if isVoxelized && canonicalPath(page.url.pathname) !== '/login'}
    {#await import('$lib/components/decorations/VoxelShader.svelte') then { default: VoxelShader }}
      <VoxelShader />
    {/await}
  {/if}
  {#if !isVoxelized}
    <ParticleCanvas />
  {/if}
  {#if canonicalPath(page.url.pathname) !== '/login' && !isVoxelized}
    <BgPattern />
  {/if}
  {#if idleReady}
    {#await import('$lib/components/layout/Toaster.svelte') then { default: Toaster }}
      <Toaster />
    {/await}
  {/if}
  {#if bugReporter.phase !== 'idle'}
    {#await import('$lib/components/layout/BugReporter.svelte') then { default: BugReporter }}
      <BugReporter />
    {/await}
  {/if}

  {#if conn.connecting}
    <div class="fixed top-0 left-0 right-0 h-[2px] bg-bg3 z-[var(--layer-toast)] overflow-hidden">
      <div class="h-full w-1/3 bg-accent animate-loading-slide"></div>
    </div>
  {/if}

  {#key canonicalPath(page.url.pathname).split('/')[1]}
    <div style="animation: page-fade-in 120ms ease-out">
      {@render children()}
    </div>
  {/key}

  {#if ui.overlayOpen}
    {#await import('$lib/components/hosts/HostsOverlay.svelte') then { default: HostsOverlay }}
      <HostsOverlay />
    {/await}
  {/if}
</ParaglideJS>
