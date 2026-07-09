<script lang="ts">
  import { page } from '$app/state';
  import { logout } from '$lib/state/features/user.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';

  const status = $derived(page.status);
  const isNoOrg = $derived(status === 403 && /organization membership/i.test(page.error?.message ?? ''));

  const title = $derived(
    isNoOrg ? "You're not in a workspace yet"
    : status === 403 ? 'Access denied'
    : status === 404 ? 'Page not found'
    : 'Something went wrong',
  );

  const blurb = $derived(
    isNoOrg
      ? "Your account is signed in, but it hasn't been added to a workspace. An admin needs to invite you before you can use the hub."
      : status === 403 ? "You don't have permission to view this page."
      : status === 404 ? "We couldn't find what you were looking for."
      : (page.error?.message ?? 'An unexpected error occurred.'),
  );
</script>

<div class="relative z-10 flex items-center justify-center min-h-screen">
  <div class="w-full max-w-md mx-4">
    <div class="bg-bg2 border border-border rounded-lg overflow-hidden shadow-2xl">
      <div class="relative px-5 py-3.5 border-b border-border bg-bg/60 flex items-center justify-between">
        <ScanLine speed={10} opacity={0.025} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">error {status}</span>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-yellow-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-green-500/60"></span>
        </div>
      </div>

      <div class="px-6 py-8 text-center">
        <div class="inline-flex items-center select-none leading-none mb-5">
          <span class="bg-brand-pink text-black font-black text-[13px] tracking-wide px-2 py-0.5 rounded-l-md uppercase">MINION</span>
          <span class="text-foreground font-bold text-[13px] px-1.5 py-0.5">hub</span>
        </div>

        <h1 class="text-lg font-semibold text-foreground mb-2">{title}</h1>
        <p class="text-sm text-muted leading-relaxed mb-6">{blurb}</p>

        <div class="flex flex-col gap-2.5">
          {#if isNoOrg}
            <a
              href="mailto:admin@minion-ai.org?subject=Workspace%20access%20request"
              class="w-full px-4 py-2 rounded border text-sm font-mono transition-all duration-150 bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 hover:border-accent/50"
            >
              Request access
            </a>
            <button
              type="button"
              onclick={() => logout()}
              class="w-full px-4 py-2 rounded border text-sm font-mono transition-all duration-150 bg-bg border-border text-muted hover:text-foreground hover:border-accent/40"
            >
              Sign out
            </button>
          {:else}
            <button
              type="button"
              onclick={() => location.reload()}
              class="w-full px-4 py-2 rounded border text-sm font-mono transition-all duration-150 bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 hover:border-accent/50"
            >
              Retry
            </button>
            <a
              href="/"
              class="w-full px-4 py-2 rounded border text-sm font-mono transition-all duration-150 bg-bg border-border text-muted hover:text-foreground hover:border-accent/40"
            >
              Back to dashboard
            </a>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
