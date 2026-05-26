<script lang="ts">
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { logout } from '$lib/state/features/user.svelte';
  const { data } = $props();
  let message = $state('');
  let submitting = $state(false);
  let submitted = $state(false);
  let errorMsg = $state<string | null>(null);

  async function submitRequest() {
    if (submitting) return;
    submitting = true; errorMsg = null;
    const res = await fetch('/api/join-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    submitting = false;
    if (res.ok) submitted = true;
    else errorMsg = 'Could not submit your request. Please try again.';
  }
</script>

<div class="relative z-10 flex items-center justify-center min-h-screen">
  <div class="w-full max-w-sm mx-4">
    <div class="bg-bg2 border border-border rounded-lg overflow-hidden shadow-2xl">
      <div class="relative px-5 py-3.5 border-b border-border bg-bg/60 flex items-center justify-between">
        <ScanLine speed={10} opacity={0.025} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">request access</span>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-yellow-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-green-500/60"></span>
        </div>
      </div>
      <div class="px-6 py-8 text-center">
        <div class="inline-flex items-center select-none leading-none mb-5">
          <span class="bg-brand-pink text-black font-black text-[13px] tracking-wide px-2 py-0.5 rounded-l-md uppercase">MINION</span>
          <span class="text-white font-bold text-[13px] px-1.5 py-0.5">hub</span>
        </div>

        {#if submitted}
          <h1 class="text-lg font-semibold text-foreground mb-2">Request sent</h1>
          <p class="text-sm text-muted mb-6">You'll get access once an admin approves your request.</p>
          <button onclick={() => logout()} class="w-full px-4 py-2 rounded border text-sm font-mono bg-bg border-border text-muted hover:text-foreground hover:border-accent/40">Sign out</button>
        {:else}
          {#if data.linkError}
            <p class="text-[11px] font-mono text-yellow-400 bg-yellow-400/8 border border-yellow-400/20 rounded px-3 py-2 mb-4">That invite link is invalid or expired. You can request access below.</p>
          {/if}
          <h1 class="text-lg font-semibold text-foreground mb-2">You're not in a workspace yet</h1>
          <p class="text-sm text-muted mb-5">Signed in as {data.email}. Request access and an admin will let you in.</p>
          <textarea bind:value={message} rows="3" placeholder="Optional: a note for the admin"
            class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60 mb-3"></textarea>
          {#if errorMsg}<div class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2 mb-3">{errorMsg}</div>{/if}
          <button onclick={submitRequest} disabled={submitting}
            class="w-full px-4 py-2 rounded border text-sm font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 disabled:opacity-50">
            {submitting ? 'Sending…' : 'Request access'}
          </button>
          <button onclick={() => logout()} class="w-full mt-2 px-4 py-2 rounded border text-sm font-mono bg-bg border-border text-muted hover:text-foreground hover:border-accent/40">Sign out</button>
        {/if}
      </div>
    </div>
  </div>
</div>
