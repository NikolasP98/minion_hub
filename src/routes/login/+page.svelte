<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';
  import * as m from '$lib/paraglide/messages';
  import { loadUser } from '$lib/state/features/user.svelte';
  import { loadHosts, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';

  const { data } = $props();

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);
  let googleLoading = $state(false);

  const redirectTo = $derived((page.url.searchParams.get('redirectTo') ?? '/') || '/');

  async function handleGoogleSignIn() {
    if (googleLoading) return;
    googleLoading = true;
    const callbackURL = `/auth/google-callback${redirectTo !== '/' ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`;
    await authClient.signIn.social({ provider: 'google', callbackURL });
    // authClient redirects the browser — no further action needed
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (loading) return;
    loading = true;
    error = null;

    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      error = result.error.message ?? m.login_invalidCredentials();
      loading = false;
      return;
    }

    // Activate first org so server hook picks up tenantCtx via activeOrganizationId
    try {
      const orgs = await authClient.organization.list();
      const firstOrg = orgs.data?.[0];
      if (firstOrg) await authClient.organization.setActive({ organizationId: firstOrg.id });
    } catch { /* non-fatal */ }

    await loadUser();
    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
    goto(redirectTo, { replaceState: true });
  }
</script>

<div class="relative z-10 flex items-center justify-center min-h-screen">
  <div class="w-full max-w-sm mx-4">
    <div class="bg-bg2 border border-border rounded-lg overflow-hidden shadow-2xl">
      <div class="relative px-5 py-3.5 border-b border-border bg-bg/60 flex items-center justify-between">
        <ScanLine speed={10} opacity={0.025} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">{m.login_title()}</span>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-yellow-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-green-500/60"></span>
        </div>
      </div>

      <div class="px-5 pt-6 pb-4 text-center">
        <div class="inline-flex items-center select-none leading-none mb-2">
          <span class="bg-brand-pink text-black font-black text-[13px] tracking-wide px-2 py-0.5 rounded-l-md uppercase">MINION</span>
          <span class="text-white font-bold text-[13px] px-1.5 py-0.5">hub</span>
        </div>
        <p class="text-[11px] text-muted font-mono">{m.login_subtitle()}</p>
      </div>

      <form onsubmit={handleSubmit} class="px-5 pb-6 space-y-3">
        <div class="space-y-1.5">
          <label class="block text-[10px] font-mono text-muted uppercase tracking-wider" for="login-email">
            {m.login_emailLabel()}
          </label>
          <input
            id="login-email" type="email" autocomplete="email" required
            bind:value={email} placeholder="admin@minion.hub"
            class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
          />
        </div>

        <div class="space-y-1.5">
          <label class="block text-[10px] font-mono text-muted uppercase tracking-wider" for="login-password">
            {m.login_passwordLabel()}
          </label>
          <input
            id="login-password" type="password" autocomplete="current-password" required
            bind:value={password} placeholder="••••••••"
            class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
          />
        </div>

        {#if error}
          <div class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2">{error}</div>
        {/if}

        <button
          type="submit" disabled={loading}
          class="w-full mt-1 px-4 py-2 rounded border text-sm font-mono transition-all duration-150
                 {loading ? 'bg-accent/10 border-accent/20 text-accent/60 cursor-not-allowed'
                          : 'bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 hover:border-accent/50'}"
        >
          {loading ? m.login_signingIn() : m.login_submit()}
        </button>
      </form>

      {#if data.googleEnabled}
      <div class="px-5 pb-5">
        <div class="flex items-center gap-3 mb-3">
          <div class="flex-1 h-px bg-border"></div>
          <span class="text-[10px] font-mono text-muted uppercase tracking-wider">or</span>
          <div class="flex-1 h-px bg-border"></div>
        </div>

        <button
          type="button"
          onclick={handleGoogleSignIn}
          disabled={googleLoading || loading}
          class="w-full flex items-center justify-center gap-2.5 px-4 py-2 rounded border text-sm font-mono transition-all duration-150
                 {googleLoading ? 'bg-bg border-border text-muted/60 cursor-not-allowed'
                               : 'bg-bg border-border text-foreground hover:border-accent/40 hover:bg-accent/5'}"
        >
          {#if !googleLoading}
            <!-- Google icon (inline SVG, 16×16) -->
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          {/if}
          {googleLoading ? 'Connecting…' : 'Sign in with Google'}
        </button>
      </div>
      {/if}
    </div>
    <p class="text-center text-[10px] text-muted/40 font-mono mt-4">{m.login_footer()}</p>
  </div>
</div>
