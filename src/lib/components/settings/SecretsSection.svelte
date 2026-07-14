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
  import { toastAsync, toastSuccess, toastError } from '$lib/state/ui/toast.svelte';
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

  // Probe result → toast severity (a 401/invalid key must NOT read as success):
  // ok=success, invalid=error, missing/unknown=warning.
  function getProbeOutcome(label: string, status: SecretsProbeStatus, message?: string) {
    const desc = message || status;
    if (status === 'ok') return { type: 'success' as const, title: label, description: desc };
    if (status === 'invalid') return { type: 'error' as const, title: label, description: desc };
    return { type: 'warning' as const, title: label, description: desc };
  }

  async function probeStatic(key: string) {
    await toastAsync<SecretsProbeResult>(
      sendRequest(SECRETS_METHODS.probe, { key }).then(async (res) => {
        const result = res as SecretsProbeResult;
        await refresh();
        return result;
      }),
      {
        loading: `Probing ${key}…`,
        getOutcome: (r: SecretsProbeResult) =>
          getProbeOutcome(`Probed ${key}`, r.probeStatus, r.probeMessage),
      },
    );
  }

  async function clearStatic(key: string) {
    if (!confirm(`Clear secret ${key}?`)) return;
    await toastAsync<void>(
      sendRequest(SECRETS_METHODS.clear, { key }).then(async () => {
        await refresh();
      }),
      {
        loading: `Clearing ${key}…`,
        getOutcome: () => ({ type: 'success' as const, title: `Cleared ${key}` }),
      },
    );
  }

  async function saveStatic(
    key: string,
    value: string,
  ): Promise<{ probeStatus: SecretsProbeStatus; probeMessage: string }> {
    return toastAsync<{ probeStatus: SecretsProbeStatus; probeMessage: string }>(
      sendRequest(SECRETS_METHODS.set, { key, value }).then((res) => {
        const result = res as SecretsSetResult;
        refresh();
        return { probeStatus: result.probeStatus, probeMessage: result.probeMessage };
      }),
      {
        loading: `Setting ${key}…`,
        getOutcome: (r) =>
          getProbeOutcome(`Set ${key}`, r.probeStatus, r.probeMessage),
      },
    );
  }

  // Dynamic actions
  async function probeScoped(groupKey: string, instanceId: string) {
    await toastAsync<SecretsProbeScopedResult>(
      sendRequest(SECRETS_METHODS.probeScoped, { groupKey, instanceId }).then(async (res) => {
        const result = res as SecretsProbeScopedResult;
        await refresh();
        return result;
      }),
      {
        loading: `Probing ${groupKey}/${instanceId}…`,
        getOutcome: (r: SecretsProbeScopedResult) =>
          getProbeOutcome(
            `Probed ${groupKey}/${instanceId}`,
            r.probeStatus,
            r.probeMessage,
          ),
      },
    );
  }

  async function clearScoped(groupKey: string, instanceId: string) {
    await toastAsync<void>(
      sendRequest(SECRETS_METHODS.clearScoped, { groupKey, instanceId }).then(async () => {
        await refresh();
      }),
      {
        loading: `Clearing ${groupKey}/${instanceId}…`,
        getOutcome: () => ({
          type: 'success' as const,
          title: `Cleared ${groupKey}/${instanceId}`,
        }),
      },
    );
  }

  async function saveScoped(
    groupKey: string,
    instanceId: string,
    value: string,
  ): Promise<{ probeStatus: SecretsProbeStatus; probeMessage: string }> {
    return toastAsync<{ probeStatus: SecretsProbeStatus; probeMessage: string }>(
      sendRequest(SECRETS_METHODS.setScoped, {
        groupKey,
        instanceId,
        value,
      }).then((res) => {
        const result = res as SecretsSetScopedResult;
        refresh();
        return { probeStatus: result.probeStatus, probeMessage: result.probeMessage };
      }),
      {
        loading: `Setting ${groupKey}/${instanceId}…`,
        getOutcome: (r) =>
          getProbeOutcome(`Set ${groupKey}/${instanceId}`, r.probeStatus, r.probeMessage),
      },
    );
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
    <div class="surface-2 rounded-lg px-5 py-4 text-xs text-muted-foreground">
      Connect to a gateway to manage secrets.
    </div>
  {:else if vaultUnavailable}
    <div class="bg-warning/10 border border-warning/30 rounded-lg px-5 py-4 text-xs text-warning">
      <p class="font-semibold mb-1">Secrets vault not available</p>
      <p>
        Configure <code class="font-mono bg-canvas/30 px-1 py-0.5 rounded">MINION_SECRETS_KEY</code>
        on the gateway and restart it to enable encrypted secret storage.
      </p>
    </div>
  {:else if loadError}
    <div class="bg-destructive/10 border border-destructive/30 rounded-lg px-5 py-4 text-xs text-destructive">
      <p class="font-semibold mb-1">Failed to load secrets</p>
      <p>{loadError}</p>
      <Button
        variant="outline"
        size="sm"
        type="button"
        class="mt-2"
        onclick={refresh}
      >
        Retry
      </Button>
    </div>
  {:else if !loaded}
    <div class="surface-2 rounded-lg px-5 py-4 text-xs text-muted-foreground">
      Loading secrets…
    </div>
  {:else if secrets.length === 0}
    <div class="surface-2 rounded-lg px-5 py-6 text-center text-xs text-muted-foreground">
      No plugins have declared secrets, or the gateway vault is not configured.
    </div>
  {:else}
    {#if statics.length > 0}
      <div class="surface-2 rounded-lg overflow-hidden">
        <header class="px-5 py-3 border-b border-border">
          <h3 class="text-sm font-semibold text-foreground">Static credentials</h3>
          <p class="text-xs text-muted-foreground mt-0.5">
            One value per secret, shared across the gateway.
          </p>
        </header>
        <ul class="divide-y divide-border">
          {#each statics as s (s.rowKey)}
            <li class="px-5 py-3 flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold text-foreground truncate">{s.label}</p>
                <p class="text-xs text-muted-foreground font-mono mt-0.5">
                  {s.groupKey}
                </p>
                {#if s.description}
                  <p class="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                {/if}
                <p class="text-xs text-muted-foreground mt-1 opacity-70">
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
