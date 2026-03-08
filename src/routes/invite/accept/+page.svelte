<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth';
  import * as m from '$lib/paraglide/messages';
  import { loadUser } from '$lib/state/features/user.svelte';
  import { loadHosts, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';

  interface InviteData {
    email: string;
    role: string;
    status: string;
    organizationName: string;
    expiresAt: string;
  }

  let invite = $state<InviteData | null>(null);
  let fetchError = $state<string | null>(null);
  let isLoadingInvite = $state(true);
  let isLoggedIn = $state(false);

  // Sign-up form fields
  let name = $state('');
  let password = $state('');

  // Action state
  let accepting = $state(false);
  let signingUp = $state(false);
  let actionError = $state<string | null>(null);

  const inviteId = $derived(page.url.searchParams.get('id') ?? '');

  $effect(() => {
    loadInvite(inviteId);
  });

  async function loadInvite(id: string) {
    if (!id) {
      fetchError = m.invite_invalid();
      isLoadingInvite = false;
      return;
    }
    isLoadingInvite = true;
    fetchError = null;
    try {
      const res = await fetch(`/api/invitations/${id}`);
      if (!res.ok) {
        fetchError = m.invite_invalid();
        isLoadingInvite = false;
        return;
      }
      invite = await res.json();

      // Check if user is already logged in
      const session = await authClient.getSession();
      isLoggedIn = !!session.data?.user;
    } catch {
      fetchError = m.invite_error();
    } finally {
      isLoadingInvite = false;
    }
  }

  async function activateOrgAndRedirect() {
    try {
      const orgs = await authClient.organization.list();
      const matchingOrg = orgs.data?.find(
        (o: { name: string }) => o.name === invite?.organizationName,
      );
      if (matchingOrg) {
        await authClient.organization.setActive({ organizationId: matchingOrg.id });
      }
    } catch {
      /* non-fatal */
    }
    await loadUser();
    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
    goto('/', { replaceState: true });
  }

  async function handleAccept() {
    if (accepting) return;
    accepting = true;
    actionError = null;
    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId: inviteId,
      });
      if (result.error) {
        actionError = result.error.message ?? m.invite_error();
        accepting = false;
        return;
      }
      await activateOrgAndRedirect();
    } catch {
      actionError = m.invite_error();
      accepting = false;
    }
  }

  async function handleSignUpAndAccept(e: SubmitEvent) {
    e.preventDefault();
    if (signingUp || !invite) return;
    signingUp = true;
    actionError = null;
    try {
      const signUpResult = await authClient.signUp.email({
        email: invite.email,
        password,
        name,
      });
      if (signUpResult.error) {
        actionError = signUpResult.error.message ?? m.invite_error();
        signingUp = false;
        return;
      }

      const acceptResult = await authClient.organization.acceptInvitation({
        invitationId: inviteId,
      });
      if (acceptResult.error) {
        actionError = acceptResult.error.message ?? m.invite_error();
        signingUp = false;
        return;
      }

      await activateOrgAndRedirect();
    } catch {
      actionError = m.invite_error();
      signingUp = false;
    }
  }
</script>

<div class="relative z-10 flex items-center justify-center min-h-screen">
  <div class="w-full max-w-sm mx-4">
    <div class="bg-bg2 border border-border rounded-lg overflow-hidden shadow-2xl">
      <!-- Card header -->
      <div
        class="relative px-5 py-3.5 border-b border-border bg-bg/60 flex items-center justify-between"
      >
        <ScanLine speed={10} opacity={0.025} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest"
          >{m.invite_heading()}</span
        >
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-yellow-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-green-500/60"></span>
        </div>
      </div>

      <!-- Card body -->
      <div class="px-5 py-6">
        {#if isLoadingInvite}
          <!-- Loading state -->
          <p class="text-center text-sm font-mono text-muted">{m.common_loading()}</p>
        {:else if fetchError}
          <!-- Fetch error / invalid invite -->
          <div
            class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2 text-center"
          >
            {fetchError}
          </div>
        {:else if invite?.status === 'expired'}
          <!-- Expired invite -->
          <div
            class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2 text-center"
          >
            {m.invite_expired()}
          </div>
        {:else if invite?.status === 'accepted'}
          <!-- Already accepted -->
          <div
            class="text-[11px] font-mono text-yellow-400 bg-yellow-400/8 border border-yellow-400/20 rounded px-3 py-2 text-center"
          >
            {m.invite_alreadyAccepted()}
          </div>
        {:else if invite}
          <!-- Valid pending invite -->
          <div class="text-center mb-5">
            <div class="inline-flex items-center select-none leading-none mb-2">
              <span
                class="bg-brand-pink text-black font-black text-[13px] tracking-wide px-2 py-0.5 rounded-l-md uppercase"
                >MINION</span
              >
              <span class="text-white font-bold text-[13px] px-1.5 py-0.5">hub</span>
            </div>
            <p class="text-[11px] text-muted font-mono">
              {m.invite_joinOrg({ orgName: invite.organizationName, role: invite.role })}
            </p>
          </div>

          {#if isLoggedIn}
            <!-- Logged-in: just show accept button -->
            {#if actionError}
              <div
                class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2 mb-3"
              >
                {actionError}
              </div>
            {/if}
            <button
              type="button"
              onclick={handleAccept}
              disabled={accepting}
              class="w-full mt-1 px-4 py-2 rounded border text-sm font-mono transition-all duration-150
                     {accepting
                ? 'bg-accent/10 border-accent/20 text-accent/60 cursor-not-allowed'
                : 'bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 hover:border-accent/50'}"
            >
              {accepting ? m.invite_accepting() : m.invite_accept()}
            </button>
          {:else}
            <!-- Not logged in: show sign-up form -->
            <p class="text-[11px] text-muted font-mono text-center mb-4">
              {m.invite_signUpSubtitle()}
            </p>

            <form onsubmit={handleSignUpAndAccept} class="space-y-3">
              <div class="space-y-1.5">
                <label
                  class="block text-[10px] font-mono text-muted uppercase tracking-wider"
                  for="invite-email"
                >
                  {m.login_emailLabel()}
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={invite.email}
                  readonly
                  class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors opacity-60"
                />
              </div>

              <div class="space-y-1.5">
                <label
                  class="block text-[10px] font-mono text-muted uppercase tracking-wider"
                  for="invite-name"
                >
                  {m.invite_nameLabel()}
                </label>
                <input
                  id="invite-name"
                  type="text"
                  required
                  bind:value={name}
                  placeholder={m.invite_namePlaceholder()}
                  class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
                />
              </div>

              <div class="space-y-1.5">
                <label
                  class="block text-[10px] font-mono text-muted uppercase tracking-wider"
                  for="invite-password"
                >
                  {m.login_passwordLabel()}
                </label>
                <input
                  id="invite-password"
                  type="password"
                  autocomplete="new-password"
                  required
                  bind:value={password}
                  placeholder="••••••••"
                  class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
                />
              </div>

              {#if actionError}
                <div
                  class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2"
                >
                  {actionError}
                </div>
              {/if}

              <button
                type="submit"
                disabled={signingUp}
                class="w-full mt-1 px-4 py-2 rounded border text-sm font-mono transition-all duration-150
                       {signingUp
                  ? 'bg-accent/10 border-accent/20 text-accent/60 cursor-not-allowed'
                  : 'bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 hover:border-accent/50'}"
              >
                {signingUp ? m.invite_signingUp() : m.invite_signUpAndAccept()}
              </button>
            </form>

            <!-- Sign in link -->
            <div class="mt-4 pt-3 border-t border-border text-center">
              <p class="text-[11px] font-mono text-muted">
                {m.invite_alreadyHaveAccount()}
                <a
                  href="/login?redirectTo={encodeURIComponent(`/invite/accept?id=${inviteId}`)}"
                  class="text-accent hover:text-accent/80 transition-colors"
                >
                  {m.invite_signIn()}
                </a>
              </p>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>
