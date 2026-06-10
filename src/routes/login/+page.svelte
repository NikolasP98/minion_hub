<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { loadHosts, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import posthog from 'posthog-js';
  import { env as publicEnv } from '$env/dynamic/public';
  import { supabaseBrowser } from '$lib/supabase/client';

  const { data } = $props();

  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let supabaseGoogleLoading = $state(false);
  // 'signin' (default) | 'signup'. Sign-up exists so a brand-new invited user
  // (arriving via a `/join?token=` link, bounced here by the auth gate) can
  // create a GoTrue account. The `on_auth_user_created` DB trigger then makes
  // their `profiles` row so `consumeLink → createMembership` can find the uuid.
  let mode = $state<'signin' | 'signup'>('signin');

  const SUPABASE_AUTH_ENABLED = publicEnv.PUBLIC_AUTH_PROVIDER === 'supabase';

  const redirectTo = $derived((page.url.searchParams.get('redirectTo') ?? '/') || '/');

  function toggleMode() {
    mode = mode === 'signin' ? 'signup' : 'signin';
    error = null;
    notice = null;
  }

  async function signInWithGoogleSupabase() {
    if (supabaseGoogleLoading) return;
    supabaseGoogleLoading = true;
    const supabase = supabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
        scopes: 'email profile',
      },
    });
  }

  async function enterApp(method: string) {
    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
    posthog.identify(email, { email });
    posthog.capture('user_signed_in', { method });
    goto(redirectTo, { replaceState: true });
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (loading) return;
    loading = true;
    error = null;
    notice = null;

    // Supabase Auth (GoTrue) is the sole provider. signInWithPassword /
    // signUp set the SSR session cookie; the server (resolveViaSupabase)
    // resolves the active org from organization_members + the active_org
    // cookie — no client-side org activation (the Better Auth organization
    // plugin is retired).
    const supabase = supabaseBrowser();

    if (mode === 'signup') {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: displayName || undefined },
          emailRedirectTo: `${window.location.origin}/login?redirectTo=${encodeURIComponent(redirectTo)}`,
        },
      });
      if (signUpError) {
        error = signUpError.message ?? m.login_invalidCredentials();
        loading = false;
        return;
      }
      // Email-confirmation ON → no session yet; user must confirm via email.
      if (!data.session) {
        notice = `Account created. Check ${email} for a confirmation link, then sign in.`;
        mode = 'signin';
        loading = false;
        return;
      }
      // Email-confirmation OFF → session is live; the on_auth_user_created
      // trigger has already provisioned the profiles row.
      posthog.capture('user_signed_up', { method: 'email' });
      await enterApp('email_signup');
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      error = signInError.message ?? m.login_invalidCredentials();
      loading = false;
      return;
    }
    await enterApp('email');
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
        <p class="text-[11px] text-muted font-mono">
          {mode === 'signup' ? 'Create your account' : m.login_subtitle()}
        </p>
      </div>

      <form onsubmit={handleSubmit} class="px-5 pb-6 space-y-3">
        {#if mode === 'signup'}
          <div class="space-y-1.5">
            <label class="block text-[10px] font-mono text-muted uppercase tracking-wider" for="login-name">
              Name
            </label>
            <input
              id="login-name" type="text" autocomplete="name"
              bind:value={displayName} placeholder="Your name"
              class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
            />
          </div>
        {/if}

        <div class="space-y-1.5">
          <label class="block text-[10px] font-mono text-muted uppercase tracking-wider" for="login-email">
            {m.login_emailLabel()}
          </label>
          <input
            id="login-email" type="email" autocomplete="email" required
            bind:value={email} placeholder="admin@minion.hub"
            class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
          />
        </div>

        <div class="space-y-1.5">
          <label class="block text-[10px] font-mono text-muted uppercase tracking-wider" for="login-password">
            {m.login_passwordLabel()}
          </label>
          <input
            id="login-password" type="password"
            autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} required
            bind:value={password} placeholder="••••••••"
            class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
          />
        </div>

        {#if error}
          <div class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2">{error}</div>
        {/if}
        {#if notice}
          <div class="text-[11px] font-mono text-accent bg-accent/8 border border-accent/20 rounded px-3 py-2">{notice}</div>
        {/if}

        <button
          type="submit" disabled={loading}
          class="w-full mt-1 px-4 py-2 rounded border text-sm font-mono transition-all duration-150
                 {loading ? 'bg-accent/10 border-accent/20 text-accent/60 cursor-not-allowed'
                          : 'bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 hover:border-accent/50'}"
        >
          {#if loading}
            {mode === 'signup' ? 'Creating account…' : m.login_signingIn()}
          {:else}
            {mode === 'signup' ? 'Create account' : m.login_submit()}
          {/if}
        </button>

        {#if SUPABASE_AUTH_ENABLED}
          <p class="text-center text-[11px] font-mono text-muted pt-1">
            {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}
            <button type="button" onclick={toggleMode} class="text-accent hover:text-accent/80 transition-colors">
              {mode === 'signup' ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        {/if}
      </form>

      {#if SUPABASE_AUTH_ENABLED}
      <div class="px-5 pb-3">
        <div class="flex items-center gap-3 mb-3">
          <div class="flex-1 h-px bg-border"></div>
          <span class="text-[10px] font-mono text-muted uppercase tracking-wider">or</span>
          <div class="flex-1 h-px bg-border"></div>
        </div>

        <button
          type="button"
          onclick={signInWithGoogleSupabase}
          disabled={supabaseGoogleLoading || loading}
          class="w-full flex items-center justify-center gap-2.5 px-4 py-2 rounded border text-sm font-mono transition-all duration-150
                 {supabaseGoogleLoading ? 'bg-bg border-border text-muted-strong cursor-not-allowed'
                                        : 'bg-bg border-border text-foreground hover:border-accent/40 hover:bg-accent/5'}"
        >
          {#if !supabaseGoogleLoading}
            <!-- Google icon (inline SVG, 16×16) -->
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          {/if}
          {supabaseGoogleLoading ? 'Connecting…' : 'Continue with Google'}
        </button>
      </div>
      {/if}
    </div>
    <p class="text-center text-[10px] text-muted-strong font-mono mt-4">{m.login_footer()}</p>
  </div>
</div>
