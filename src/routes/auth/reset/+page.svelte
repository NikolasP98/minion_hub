<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { supabaseBrowser } from '$lib/supabase/client';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';

  let { data }: { data: PageData } = $props();

  let newPassword = $state('');
  let confirmPassword = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let done = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (saving) return;
    error = null;

    if (newPassword.length < 8) {
      error = m.account_security_passwordTooShort();
      return;
    }
    if (newPassword !== confirmPassword) {
      error = m.account_security_passwordMismatch();
      return;
    }

    saving = true;
    const { error: updateError } = await supabaseBrowser().auth.updateUser({
      password: newPassword,
    });
    saving = false;
    if (updateError) {
      error = updateError.message;
      return;
    }

    done = true;
    setTimeout(() => goto('/', { replaceState: true }), 1500);
  }
</script>

<div class="relative z-10 flex items-center justify-center min-h-screen">
  <div class="w-full max-w-sm mx-4">
    <div class="bg-bg2 border border-border rounded-lg overflow-hidden shadow-2xl">
      <div class="relative px-5 py-3.5 border-b border-border bg-bg/60 flex items-center justify-between">
        <ScanLine speed={10} opacity={0.025} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">{m.reset_title()}</span>
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
        <p class="text-[11px] text-muted font-mono">{m.reset_subtitle()}</p>
      </div>

      {#if !data.ok}
        <div class="px-5 pb-6 space-y-3">
          <div class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2">
            {m.reset_invalidToken()}
          </div>
          <a href="/login/forgot" class="block text-center text-[11px] font-mono text-accent hover:text-accent/80 transition-colors">
            {m.reset_requestNew()}
          </a>
        </div>
      {:else if done}
        <div class="px-5 pb-6">
          <div class="text-[11px] font-mono text-accent bg-accent/8 border border-accent/20 rounded px-3 py-2">
            {m.reset_success()}
          </div>
        </div>
      {:else}
        <form onsubmit={handleSubmit} class="px-5 pb-6 space-y-3">
          <div class="space-y-1.5">
            <label class="block text-[10px] font-mono text-muted uppercase tracking-wider" for="reset-password">
              {m.reset_newPasswordLabel()}
            </label>
            <input
              id="reset-password" type="password" autocomplete="new-password" required
              bind:value={newPassword} placeholder="••••••••"
              class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
            />
          </div>

          <div class="space-y-1.5">
            <label class="block text-[10px] font-mono text-muted uppercase tracking-wider" for="reset-confirm">
              {m.reset_confirmPasswordLabel()}
            </label>
            <input
              id="reset-confirm" type="password" autocomplete="new-password" required
              bind:value={confirmPassword} placeholder="••••••••"
              class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
            />
          </div>

          {#if error}
            <div class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2">{error}</div>
          {/if}

          <button
            type="submit" disabled={saving}
            class="w-full mt-1 px-4 py-2 rounded border text-sm font-mono transition-all duration-150
                   {saving ? 'bg-accent/10 border-accent/20 text-accent/60 cursor-not-allowed'
                           : 'bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 hover:border-accent/50'}"
          >
            {saving ? m.reset_submitting() : m.reset_submit()}
          </button>
        </form>
      {/if}
    </div>
    <p class="text-center text-[10px] text-muted-strong font-mono mt-4">{m.login_footer()}</p>
  </div>
</div>
