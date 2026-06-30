<script lang="ts">
  import { onMount } from 'svelte';
  import { Power, ShieldAlert, Radio, Megaphone, TriangleAlert } from 'lucide-svelte';
  import { Card, Badge, Button, Toggle, EmptyState, PageHeader, Modal } from '$lib/components/ui';
  import { sendRequest } from '$lib/services/gateway-rpc';
  import { conn } from '$lib/state/gateway';

  type Group = 'core' | 'channels' | 'future';
  type KillSwitch = {
    id: string;
    label: string;
    group: Group;
    enabled: boolean;
    available: boolean;
    description?: string;
  };
  type ListResp = {
    master: { id: string; label: string; enabled: boolean };
    switches: KillSwitch[];
  };

  let data = $state<ListResp | null>(null);
  let loading = $state(true);
  let err = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let confirmKill = $state(false);

  const core = $derived(data?.switches.filter((s) => s.group === 'core') ?? []);
  const channels = $derived(data?.switches.filter((s) => s.group === 'channels') ?? []);
  const future = $derived(data?.switches.filter((s) => s.group === 'future') ?? []);
  const masterLive = $derived(data?.master.enabled ?? false);

  async function load() {
    loading = true;
    err = null;
    try {
      data = (await sendRequest('killswitch.list', {})) as ListResp;
    } catch (e) {
      err = e instanceof Error ? e.message : 'Failed to load kill switches';
    } finally {
      loading = false;
    }
  }

  async function setSwitch(id: string, enabled: boolean) {
    busy = id;
    try {
      data = (await sendRequest('killswitch.set', { id, enabled })) as ListResp;
    } catch (e) {
      err = e instanceof Error ? e.message : 'Toggle failed';
    } finally {
      busy = null;
    }
  }

  function onMasterToggle(next: boolean) {
    if (!next) {
      confirmKill = true; // killing the whole system → confirm
    } else {
      void setSwitch('master', true);
    }
  }

  function confirmMasterKill() {
    confirmKill = false;
    void setSwitch('master', false);
  }

  const groupIcon: Record<Group, typeof Radio> = {
    core: Megaphone,
    channels: Radio,
    future: ShieldAlert,
  };

  onMount(load);
</script>

<svelte:head><title>Kill Switches · Minion hub</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-6">
  <PageHeader title="Kill Switches" subtitle="Owner-only runtime controls. Switches are live and reset to config defaults on gateway restart.">
    {#snippet leading()}<Power size={20} />{/snippet}
  </PageHeader>

  {#if !conn.connected}
    <EmptyState tone="neutral" title="Gateway not connected" description="Connect to a gateway to view and control kill switches." />
  {:else if loading}
    <p class="text-muted-foreground text-sm">Loading…</p>
  {:else if err}
    <Card padding="lg"><p class="text-destructive text-sm">{err}</p></Card>
  {:else if data}
    <!-- MASTER -->
    <Card padding="lg" elevation={3}>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="grid size-10 place-items-center rounded-full {masterLive ? 'bg-emerald-500/15 text-emerald-500' : 'bg-destructive/15 text-destructive'}">
            <Power size={20} />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-semibold">Master switch</h2>
              <Badge variant="semantic" value={masterLive ? 'success' : 'error'}>{masterLive ? 'System live' : 'System killed'}</Badge>
            </div>
            <p class="text-muted-foreground text-sm">Kills all channels, TTS and heartbeats at once.</p>
          </div>
        </div>
        <Toggle
          checked={masterLive}
          disabled={busy === 'master'}
          label="Master switch"
          onchange={onMasterToggle}
        />
      </div>
      {#if !masterLive}
        <div class="text-destructive mt-3 flex items-center gap-2 text-sm">
          <TriangleAlert size={15} /> System is killed — channels, TTS and heartbeats are stopped.
        </div>
      {/if}
    </Card>

    {#each [['core', 'Core services', core], ['channels', 'Channels', channels], ['future', 'Future (not yet wired)', future]] as const as [g, heading, list]}
      {#if list.length}
        {@const Icon = groupIcon[g]}
        <section class="mt-6">
          <div class="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
            <Icon size={13} />{heading}
          </div>
          <Card padding="none">
            <ul class="divide-border divide-y">
              {#each list as s (s.id)}
                <li class="flex items-center justify-between gap-4 px-4 py-3" class:opacity-55={!s.available}>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-medium">{s.label}</span>
                      {#if !s.available}<Badge>Coming soon</Badge>{/if}
                    </div>
                    {#if s.description}<p class="text-muted-foreground truncate text-xs">{s.description}</p>{/if}
                  </div>
                  <Toggle
                    checked={s.enabled}
                    disabled={!s.available || busy === s.id}
                    label={s.label}
                    onchange={(next) => setSwitch(s.id, next)}
                  />
                </li>
              {/each}
            </ul>
          </Card>
        </section>
      {/if}
    {/each}
  {/if}
</div>

<Modal bind:open={confirmKill} size="sm" title="Kill the whole system?">
  <p class="text-sm">
    This stops <strong>all channels</strong>, text-to-speech and heartbeats immediately. Inbound and
    outbound messaging will halt until you flip the master switch back on. No data is deleted and no
    channel is logged out.
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmKill = false)}>Cancel</Button>
    <Button variant="danger" onclick={confirmMasterKill}>Kill system</Button>
  {/snippet}
</Modal>
