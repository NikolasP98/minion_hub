<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';

  let identifier = $state('');
  let loading = $state(false);
  let sent = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (loading) return;
    loading = true;
    try {
      // Always 200 per spec (no account-existence enumeration) — the request
      // itself never surfaces an error to the caller.
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      sent = true;
    } finally {
      loading = false;
    }
  }
</script>

<div class="relative z-10 flex items-center justify-center min-h-screen">
  <div class="w-full max-w-sm mx-4">
    <div class="bg-bg2 border border-border rounded-lg overflow-hidden shadow-2xl">
      <div class="relative px-5 py-3.5 border-b border-border bg-bg/60 flex items-center justify-between">
        <ScanLine speed={10} opacity={0.025} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">{m.login_forgot_title()}</span>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-yellow-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-green-500/60"></span>
        </div>
      </div>

      <div class="px-5 pt-6 pb-4 text-center">
        <div class="inline-flex items-center select-none leading-none mb-2">
          <span class="bg-brand-pink text-black font-black text-[13px] tracking-wide px-2 py-0.5 rounded-l-md uppercase">MINION</span>
          <span class="text-foreground font-bold text-[13px] px-1.5 py-0.5">hub</span>
        </div>
        <p class="text-[11px] text-muted font-mono">{m.login_forgot_subtitle()}</p>
      </div>

      {#if sent}
        <div class="px-5 pb-6 space-y-3">
          <div class="text-[11px] font-mono text-accent bg-accent/8 border border-accent/20 rounded px-3 py-2">
            {m.login_forgot_sent()}
          </div>
          <a href="/login" class="block text-center text-[11px] font-mono text-accent hover:text-accent/80 transition-colors">
            {m.login_forgot_backToLogin()}
          </a>
        </div>
      {:else}
        <form onsubmit={handleSubmit} class="px-5 pb-6 space-y-3">
          <div class="space-y-1.5">
            <label class="block text-[10px] font-mono text-muted uppercase tracking-wider" for="forgot-identifier">
              {m.login_identifierLabel()}
            </label>
            <input
              id="forgot-identifier" type="text" autocomplete="username" required
              bind:value={identifier} placeholder="admin@minion.hub"
              class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
            />
          </div>

          <button
            type="submit" disabled={loading}
            class="w-full mt-1 px-4 py-2 rounded border text-sm font-mono transition-all duration-150
                   {loading ? 'bg-accent/10 border-accent/20 text-accent/60 cursor-not-allowed'
                            : 'bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 hover:border-accent/50'}"
          >
            {loading ? m.login_forgot_sending() : m.login_forgot_submit()}
          </button>

          <p class="text-center text-[11px] font-mono text-muted pt-1">
            <a href="/login" class="text-accent hover:text-accent/80 transition-colors">{m.login_forgot_backToLogin()}</a>
          </p>
        </form>
      {/if}
    </div>
    <p class="text-center text-[10px] text-muted-strong font-mono mt-4">{m.login_footer()}</p>
  </div>
</div>
