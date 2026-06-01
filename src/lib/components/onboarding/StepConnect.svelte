<script lang="ts">
  import ChannelLinking from '$lib/components/users/ChannelLinking.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { PlugZap } from 'lucide-svelte';

  type Identity = {
    id: string;
    source?: 'turso' | 'supabase';
    provider: string;
    kind: 'oauth' | 'channel';
    externalId: string;
    displayName: string | null;
    verifiedAt: number | null;
  };

  interface Props {
    userId: string;
    identities: Identity[];
    prev: () => void;
    onfinish: () => void;
    busy?: boolean;
    error?: string;
  }

  let { userId, identities, prev, onfinish, busy = false, error = '' }: Props = $props();
</script>

<div class="step">
  <div class="intro">
    <div class="intro-icon"><PlugZap size={18} /></div>
    <div>
      <h2>Connect Your Channels</h2>
      <p class="subtitle">
        These are the real installed channel plugins from your active gateway. Open each plugin's
        setup flow here — QR pairing, forms, and plugin iframes run against the gateway, not a mock checklist.
      </p>
    </div>
  </div>

  {#if !conn.connected}
    <div class="notice">
      Connect to a gateway first. Channel setup is plugin-driven and requires a live gateway connection.
    </div>
  {/if}

  <ChannelLinking {userId} {identities} />

  {#if error}<div class="error-banner">{error}</div>{/if}

  <div class="buttons">
    <button type="button" class="btn-secondary" onclick={prev} disabled={busy}>← Back</button>
    <button type="button" class="btn-primary" onclick={onfinish} disabled={busy || !conn.connected}>
      {busy ? 'Creating agent…' : 'Create my agent ✨'}
    </button>
  </div>
</div>

<style>
  .step { display: flex; flex-direction: column; gap: 1rem; }
  .intro { display: flex; gap: 0.85rem; align-items: flex-start; }
  .intro-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    color: var(--color-accent);
    flex: 0 0 auto;
  }
  h2 { font-size: 1.1rem; font-weight: 600; color: var(--color-foreground); margin: 0 0 0.3rem; }
  .subtitle { font-size: 0.8rem; color: var(--color-muted-foreground); margin: 0; line-height: 1.45; }
  .notice {
    background: color-mix(in srgb, var(--color-warning) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
    border-radius: var(--radius-lg);
    padding: 0.75rem;
    font-size: 0.8rem;
    color: var(--color-warning);
  }
  .error-banner {
    background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-destructive) 30%, transparent);
    border-radius: var(--radius-lg); padding: 0.75rem;
    font-size: 0.8rem; color: var(--color-destructive);
  }
  .buttons { display: flex; gap: 0.75rem; margin-top: 0.5rem; }
  .btn-primary {
    background: var(--color-accent); color: var(--color-accent-foreground);
    border: none; border-radius: var(--radius-lg); padding: 0.85rem 1.5rem;
    font-size: 0.95rem; font-weight: 600; cursor: pointer; flex: 1;
    transition: opacity var(--duration-fast), transform var(--duration-fast);
  }
  .btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .btn-secondary {
    background: var(--color-bg3); color: var(--color-muted);
    border: 1px solid var(--color-border); border-radius: var(--radius-lg);
    padding: 0.85rem 1.5rem; font-size: 0.95rem; font-weight: 500;
    cursor: pointer; transition: background var(--duration-fast);
  }
  .btn-secondary:hover:not(:disabled) { background: var(--color-bg2); }
  button:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
</style>
