<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';
  import * as m from '$lib/paraglide/messages';
  import { loadUser } from '$lib/state/user.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);

  const redirectTo = $derived((page.url.searchParams.get('redirectTo') ?? '/') || '/');

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
    </div>
    <p class="text-center text-[10px] text-muted/40 font-mono mt-4">{m.login_footer()}</p>
  </div>
</div>
