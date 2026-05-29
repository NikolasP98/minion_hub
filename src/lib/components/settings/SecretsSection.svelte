<script lang="ts">
  import {
    SECRETS_METHODS,
    type SecretsSummary,
    type SecretsListResult,
    type SecretsSetResult,
    type SecretsSetScopedResult,
    type SecretsProbeResult,
    type SecretsProbeScopedResult,
    type SecretsProbeStatus,
  } from '$lib/types/secrets';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';
  import { Button } from '$lib/components/ui';
  import SecretStatusPill from './SecretStatusPill.svelte';
  import SecretEditModal from './SecretEditModal.svelte';
  import DynamicSecretGroup from './DynamicSecretGroup.svelte';

  type EditTarget =
    | { kind: 'static'; key: string; label: string }
    | { kind: 'dynamic'; groupKey: string; instanceId: string; label: string };

  let secrets = $state<SecretsSummary[]>([]);
  let loaded = $state(false);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let vaultUnavailable = $state(false);
  let editing = $state<EditTarget | null>(null);

  const statics = $derived(secrets.filter((s) => s.kind === 'static'));
  const dynamics = $derived(secrets.filter((s) => s.kind === 'dynamic'));

  // Group dynamics by groupKey
  const dynamicGroups = $derived.by(() => {
    const map = new Map<string, SecretsSummary[]>();
    for (const s of dynamics) {
      const arr = map.get(s.groupKey) ?? [];
      arr.push(s);
      map.set(s.groupKey, arr);
    }
    return Array.from(map.entries()).map(([groupKey, items]) => ({
      groupKey,
      label: items[0]?.label ?? groupKey,
      ownerPlugin: items[0]?.ownerPlugin ?? '',
      instances: items,
    }));
  });

  async function refresh() {
    if (!conn.connected) return;
    loading = true;
    loadError = null;
    vaultUnavailable = false;
    try {
      const res = (await sendRequest(SECRETS_METHODS.list, {})) as SecretsListResult;
      secrets = res.secrets ?? [];
      loaded = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unavailable|MINION_SECRETS_KEY|vault/i.test(msg)) {
        vaultUnavailable = true;
      } else {
        loadError = msg;
      }
    } finally {
      loading = false;
    }
  }

  // Load when connection comes up
  $effect(() => {
    if (conn.connected && !loaded && !loading) {
      refresh();
    }
  });

  function fmtTime(t: number | null): string {
    if (!t) return 'never';
    return new Date(t).toLocaleString();
  }

  // Static actions
  async function probeStatic(key: string) {
    try {
      const res = (await sendRequest(SECRETS_METHODS.probe, { key })) as SecretsProbeResult;
      toastSuccess(`Probed ${key}`, res.probeMessage || res.probeStatus);
      await refresh();
    } catch (err) {
      toastError(`Probe failed`, err instanceof Error ? err.message : String(err));
    }
  }

  async function clearStatic(key: string) {
    if (!confirm(`Clear secret ${key}?`)) return;
    try {
      await sendRequest(SECRETS_METHODS.clear, { key });
      toastSuccess(`Cleared ${key}`);
      await refresh();
    } catch (err) {
      toastError(`Clear failed`, err instanceof Error ? err.message : String(err));
    }
  }

  async function saveStatic(
    key: string,
    value: string,
  ): Promise<{ probeStatus: SecretsProbeStatus; probeMessage: string }> {
    const res = (await sendRequest(SECRETS_METHODS.set, { key, value })) as SecretsSetResult;
    // refresh in background
    refresh();
    return { probeStatus: res.probeStatus, probeMessage: res.probeMessage };
  }

  // Dynamic actions
  async function probeScoped(groupKey: string, instanceId: string) {
    try {
      const res = (await sendRequest(SECRETS_METHODS.probeScoped, {
        groupKey,
        instanceId,
      })) as SecretsProbeScopedResult;
      toastSuccess(`Probed ${groupKey}/${instanceId}`, res.probeMessage || res.probeStatus);
      await refresh();
    } catch (err) {
      toastError(`Probe failed`, err instanceof Error ? err.message : String(err));
    }
  }

  async function clearScoped(groupKey: string, instanceId: string) {
    try {
      await sendRequest(SECRETS_METHODS.clearScoped, { groupKey, instanceId });
      toastSuccess(`Cleared ${groupKey}/${instanceId}`);
      await refresh();
    } catch (err) {
      toastError(`Clear failed`, err instanceof Error ? err.message : String(err));
    }
  }

  async function saveScoped(
    groupKey: string,
    instanceId: string,
    value: string,
  ): Promise<{ probeStatus: SecretsProbeStatus; probeMessage: string }> {
    const res = (await sendRequest(SECRETS_METHODS.setScoped, {
      groupKey,
      instanceId,
      value,
    })) as SecretsSetScopedResult;
    refresh();
    return { probeStatus: res.probeStatus, probeMessage: res.probeMessage };
  }

  // Modal save dispatcher
  async function handleModalSave(value: string) {
    if (!editing) throw new Error('no edit target');
    if (editing.kind === 'static') {
      return saveStatic(editing.key, value);
    }
    return saveScoped(editing.groupKey, editing.instanceId, value);
  }
</script>

<section class="space-y-4">
  <header>
    <h2 class="text-sm font-semibold text-foreground">Secrets</h2>
    <p class="text-xs text-muted-foreground mt-0.5">
      API keys and credentials consumed by plugins. Stored encrypted in the gateway vault.
    </p>
  </header>

  {#if !conn.connected}
    <div class="bg-card border border-border rounded-lg px-5 py-4 text-xs text-muted-foreground">
      Connect to a gateway to manage secrets.
    </div>
  {:else if vaultUnavailable}
    <div class="bg-amber-500/10 border border-amber-500/30 rounded-lg px-5 py-4 text-xs text-amber-200">
      <p class="font-semibold mb-1">Secrets vault not available</p>
      <p>
        Configure <code class="font-mono bg-black/30 px-1 py-0.5 rounded">MINION_SECRETS_KEY</code>
        on the gateway and restart it to enable encrypted secret storage.
      </p>
    </div>
  {:else if loadError}
    <div class="bg-rose-500/10 border border-rose-500/30 rounded-lg px-5 py-4 text-xs text-rose-200">
      <p class="font-semibold mb-1">Failed to load secrets</p>
      <p>{loadError}</p>
      <button
        type="button"
        class="mt-2 text-[11px] text-rose-100 hover:underline"
        onclick={refresh}
      >
        Retry
      </button>
    </div>
  {:else if !loaded}
    <div class="bg-card border border-border rounded-lg px-5 py-4 text-xs text-muted-foreground">
      Loading secrets…
    </div>
  {:else if secrets.length === 0}
    <div class="bg-card border border-border rounded-lg px-5 py-6 text-center text-xs text-muted-foreground">
      No plugins have declared secrets, or the gateway vault is not configured.
    </div>
  {:else}
    {#if statics.length > 0}
      <div class="bg-card border border-border rounded-lg overflow-hidden">
        <header class="px-5 py-3 border-b border-border">
          <h3 class="text-sm font-semibold text-foreground">Static credentials</h3>
          <p class="text-[11px] text-muted-foreground mt-0.5">
            One value per secret, shared across the gateway.
          </p>
        </header>
        <ul class="divide-y divide-border">
          {#each statics as s (s.rowKey)}
            <li class="px-5 py-3 flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold text-foreground truncate">{s.label}</p>
                <p class="text-[11px] text-muted-foreground font-mono mt-0.5">
                  {s.groupKey}
                </p>
                {#if s.description}
                  <p class="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>
                {/if}
                <p class="text-[10px] text-muted-foreground mt-1 opacity-70">
                  Owner: {s.ownerPlugin} · Last checked: {fmtTime(s.lastProbeAt)}
                </p>
              </div>
              <SecretStatusPill status={s.probeStatus} message={s.probeMessage} />
              <div class="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onclick={() => probeStatic(s.groupKey)}
                  disabled={!s.configured}
                  title={s.configured ? 'Re-probe' : 'Set a value first'}
                >
                  Probe
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => (editing = { kind: 'static', key: s.groupKey, label: s.label })}
                >
                  {s.configured ? 'Rotate' : 'Set'}
                </Button>
                {#if s.configured}
                  <Button variant="danger" size="sm" onclick={() => clearStatic(s.groupKey)}>
                    Clear
                  </Button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#each dynamicGroups as g (g.groupKey)}
      <DynamicSecretGroup
        groupKey={g.groupKey}
        label={g.label}
        scopeLabel="Per-instance"
        ownerPlugin={g.ownerPlugin}
        instances={g.instances}
        onRotate={(instanceId) => {
          editing = {
            kind: 'dynamic',
            groupKey: g.groupKey,
            instanceId,
            label: `${g.label} — ${instanceId}`,
          };
        }}
        onClear={(instanceId) => clearScoped(g.groupKey, instanceId)}
        onProbe={(instanceId) => probeScoped(g.groupKey, instanceId)}
      />
    {/each}
  {/if}
</section>

<SecretEditModal
  open={editing !== null}
  secretKey={editing
    ? editing.kind === 'static'
      ? editing.key
      : `${editing.groupKey}/${editing.instanceId}`
    : ''}
  secretLabel={editing?.label ?? ''}
  onClose={() => (editing = null)}
  onSave={handleModalSave}
/>
