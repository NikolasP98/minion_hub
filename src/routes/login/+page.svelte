<script lang="ts">
  import { goto } from '$lib/navigation';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { loadHosts, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { Button, Input } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { Globe2, LogIn } from 'lucide-svelte';
  import posthog from 'posthog-js';
  import { env as publicEnv } from '$env/dynamic/public';
  import { supabaseBrowser } from '$lib/supabase/client';

  let identifier = $state(''); // sign-in: email or username
  let email = $state(''); // sign-up: email only
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

  const redirectTo = $derived.by(() => {
    const requested = page.url.searchParams.get('redirectTo') ?? '/';
    return requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';
  });

  function toggleMode() {
    mode = mode === 'signin' ? 'signup' : 'signin';
    error = null;
    notice = null;
  }

  async function signInWithGoogleSupabase() {
    if (supabaseGoogleLoading) return;
    supabaseGoogleLoading = true;
    error = null;
    try {
      const supabase = supabaseBrowser();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { access_type: 'offline', prompt: 'consent' },
          scopes:
            'email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events',
        },
      });
      if (oauthError) error = oauthError.message;
    } catch {
      error = m.login_invalidCredentials();
    } finally {
      supabaseGoogleLoading = false;
    }
  }

  async function enterApp(method: string, identity?: string) {
    try {
      await loadHosts();
      if (hostsState.activeHostId) wsConnect();
    } catch {
      // Authentication succeeded; host discovery can recover inside the app.
    }
    const id = identity ?? email;
    posthog.identify(id, { email: id });
    posthog.capture('user_signed_in', { method });
    goto(redirectTo, { replaceState: true });
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (loading) return;
    loading = true;
    error = null;
    notice = null;

    try {
      if (mode === 'signup') {
        // Supabase Auth (GoTrue) is the sole provider. signUp sets the SSR
        // session cookie; the server (resolveViaSupabase) resolves the active
        // org from organization_members + the active_org cookie — no
        // client-side org activation (the Better Auth organization plugin is
        // retired).
        const supabase = supabaseBrowser();
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
          return;
        }
        // Email-confirmation ON → no session yet; user must confirm via email.
        if (!data.session) {
          notice = `Account created. Check ${email} for a confirmation link, then sign in.`;
          mode = 'signin';
          return;
        }
        // Email-confirmation OFF → session is live; the on_auth_user_created
        // trigger has already provisioned the profiles row.
        posthog.capture('user_signed_up', { method: 'email' });
        await enterApp('email_signup');
        return;
      }

      // Sign-in accepts email OR username — the server resolves username→email
      // and verifies the password server-side so the mapping never leaks to
      // the client. A successful response also sets the SSR session cookies.
      const response = await fetch('/api/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (!response.ok) {
        error = m.login_invalidCredentials();
        return;
      }
      await enterApp('password', identifier);
    } catch {
      error = 'The authentication service is unavailable. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{mode === 'signup' ? 'Create account' : 'Sign in'} — Minion Hub</title>
</svelte:head>

{#snippet taskIcon()}<LogIn size={20} />{/snippet}
{#snippet footer()}<span>{m.login_footer()}</span>{/snippet}

<PublicTaskShell
  eyebrow={m.login_title()}
  title={mode === 'signup' ? 'Create your account' : m.login_subtitle()}
  description={mode === 'signup'
    ? 'Set up the identity you will use across Minion Hub.'
    : 'Use your email, username, or connected Google account.'}
  icon={taskIcon}
  {footer}
>
  <form onsubmit={handleSubmit} class="flex flex-col gap-3">
    {#if mode === 'signup'}
      <Input
        id="login-name"
        type="text"
        autocomplete="name"
        label="Name"
        bind:value={displayName}
        placeholder="Your name"
        size="touch"
      />
      <Input
        id="login-email"
        type="email"
        autocomplete="email"
        label={m.login_emailLabel()}
        bind:value={email}
        placeholder="admin@minion.hub"
        size="touch"
        required
      />
    {:else}
      <Input
        id="login-identifier"
        type="text"
        autocomplete="username"
        label={m.login_identifierLabel()}
        bind:value={identifier}
        placeholder="admin@minion.hub"
        size="touch"
        required
      />
    {/if}

    <Input
      id="login-password"
      type="password"
      autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
      label={m.login_passwordLabel()}
      bind:value={password}
      placeholder="••••••••"
      size="touch"
      required
    />

    {#if mode === 'signin'}
      <a
        href="/login/forgot"
        class="self-end text-xs font-mono text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-accent"
      >
        {m.login_forgotLink()}
      </a>
    {/if}

    <div aria-live="polite" class="contents">
      {#if error}
        <p
          class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      {/if}
      {#if notice}
        <p
          class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] px-3 py-2 text-xs text-success"
        >
          {notice}
        </p>
      {/if}
    </div>

    <Button type="submit" variant="primary" size="touch" {loading} class="w-full">
      {mode === 'signup' ? 'Create account' : m.login_submit()}
    </Button>

    {#if SUPABASE_AUTH_ENABLED}
      <div class="flex items-center gap-3" aria-hidden="true">
        <span class="h-px flex-1 bg-border"></span>
        <span class="text-xs font-mono uppercase tracking-wider text-muted-foreground">or</span>
        <span class="h-px flex-1 bg-border"></span>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="touch"
        loading={supabaseGoogleLoading}
        disabled={loading}
        onclick={signInWithGoogleSupabase}
        class="w-full"
      >
        <Globe2 size={17} aria-hidden="true" />
        Continue with Google
      </Button>

      <p class="text-center text-xs text-muted-foreground">
        {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}
        <Button type="button" variant="ghost" size="sm" onclick={toggleMode}>
          {mode === 'signup' ? 'Sign in' : 'Sign up'}
        </Button>
      </p>
    {/if}
  </form>
</PublicTaskShell>
