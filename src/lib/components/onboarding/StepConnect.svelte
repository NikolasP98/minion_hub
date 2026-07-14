<script lang="ts">
  import ChannelLinking from '$lib/components/users/ChannelLinking.svelte';
  import { Button } from '$lib/components/ui';
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

<div class="flex flex-col gap-5">
  <div class="flex items-start gap-3">
    <div
      class="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--color-accent)_24%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-accent"
    >
      <PlugZap size={18} />
    </div>
    <div>
      <h2 class="text-base font-semibold text-foreground">Connect your channels</h2>
      <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
        These are the real installed channel plugins from your active gateway. Open each plugin's
        setup flow here — QR pairing, forms, and plugin iframes run against the gateway, not a mock
        checklist.
      </p>
    </div>
  </div>

  {#if !conn.connected}
    <div
      class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] px-3 py-2 text-sm leading-relaxed text-warning"
      role="status"
    >
      Connect to a gateway first. Channel setup is plugin-driven and requires a live gateway
      connection.
    </div>
  {/if}

  <ChannelLinking {userId} {identities} />

  {#if error}
    <div
      class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-3 py-2 text-sm leading-relaxed text-destructive"
      role="alert"
    >
      {error}
    </div>
  {/if}

  <div class="flex flex-col-reverse gap-2 sm:flex-row">
    <Button type="button" variant="secondary" size="touch" onclick={prev} disabled={busy}>
      ← Back
    </Button>
    <Button
      type="button"
      variant="primary"
      size="touch"
      onclick={onfinish}
      loading={busy}
      disabled={!conn.connected}
      class="flex-1"
    >
      Create my agent ✨
    </Button>
  </div>
</div>
