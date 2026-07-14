<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Archive, CloudCog, DatabaseBackup, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-svelte';
  import CloudEmpty from '$lib/components/cloud/CloudEmpty.svelte';
  import { archiveShell, backupNow, destroyShell, restartShell } from '$lib/services/shells-rpc';
  import { cloudShell, cloudState, refreshCloud } from '$lib/state/features/cloud.svelte';
  import * as m from '$lib/paraglide/messages';

  const { data } = $props();
  const selected = $derived(cloudShell(page.url.searchParams.get('server')));
  let action = $state<string | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>, success: string): Promise<void> {
    action = label;
    error = null;
    notice = null;
    try {
      await fn();
      notice = success;
      await refreshCloud();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      action = null;
    }
  }

  async function remove(): Promise<void> {
    if (!selected || !confirm(m.cloud_destroy_confirm({ name: selected.displayName }))) return;
    await run('destroy', () => destroyShell(selected.shellId), m.cloud_destroyed());
    if (!error) await goto('/cloud');
  }
</script>

<svelte:head><title>{m.cloud_settings_title()} · Minion hub</title></svelte:head>

<main class="page">
  {#if cloudState.loading}
    <div class="loading">{m.common_loading()}</div>
  {:else if !selected}
    <CloudEmpty canManage={data.canManage ?? false} />
  {:else}
    <div class="intro"><span class="eyebrow">{selected.vmName}</span><h2>{m.cloud_settings_title()}</h2><p>{m.cloud_settings_description()}</p></div>
    {#if error}<div class="alert error" role="alert">{error}</div>{/if}
    {#if notice}<div class="alert success" role="status">{notice}</div>{/if}

    <section>
      <header><CloudCog size={15} /><div><h3>{m.cloud_machine_configuration()}</h3><p>{m.cloud_machine_configuration_hint()}</p></div></header>
      <dl>
        <div><dt>{m.cloud_provider()}</dt><dd>{selected.provider ?? 'exe.dev'}</dd></div>
        <div><dt>{m.cloud_blueprint()}</dt><dd>{selected.blueprint ?? 'minion-workstation-v1'}</dd></div>
        <div><dt>{m.cloud_operating_system()}</dt><dd>{m.cloud_os_profile_value()}</dd></div>
        <div><dt>{m.cloud_resources()}</dt><dd>{selected.cpu ?? 2} vCPU · {Math.round(selected.memoryMB / 1024)} GB RAM · {selected.diskGB} GB SSD</dd></div>
        <div><dt>{m.cloud_region()}</dt><dd>{selected.region}</dd></div>
        <div><dt>{m.cloud_backup_policy()}</dt><dd>{selected.backupCadence}</dd></div>
      </dl>
    </section>

    <section>
      <header><ShieldCheck size={15} /><div><h3>{m.cloud_runtime_stack()}</h3><p>{m.cloud_runtime_stack_hint()}</p></div></header>
      <div class="runtime-grid">
        {#each selected.runtimes ?? [selected.harness] as runtime (runtime)}
          <div><span class="status-dot"></span><strong>{runtime}</strong><small>{m.cloud_installed()}</small></div>
        {/each}
        <div><span class="status-dot base"></span><strong>{m.cloud_package_chromium()}</strong><small>{m.cloud_base_image()}</small></div>
      </div>
    </section>

    <section>
      <header><DatabaseBackup size={15} /><div><h3>{m.cloud_lifecycle()}</h3><p>{m.cloud_lifecycle_hint()}</p></div></header>
      <div class="actions">
        <button disabled={action !== null} onclick={() => void run('backup', () => backupNow(selected.shellId), m.cloud_backup_started())}>
          {#if action === 'backup'}<Loader2 size={14} class="animate-spin" />{:else}<DatabaseBackup size={14} />{/if}<span><strong>{m.cloud_backup_now()}</strong><small>{m.cloud_backup_now_hint()}</small></span>
        </button>
        <button disabled={action !== null} onclick={() => void run('restart', () => restartShell(selected.shellId), m.cloud_restart_started())}>
          {#if action === 'restart'}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}<span><strong>{m.cloud_restart()}</strong><small>{m.cloud_restart_hint()}</small></span>
        </button>
        <button disabled={action !== null || selected.status !== 'online'} onclick={() => void run('archive', () => archiveShell(selected.shellId), m.cloud_archive_started())}>
          {#if action === 'archive'}<Loader2 size={14} class="animate-spin" />{:else}<Archive size={14} />{/if}<span><strong>{m.cloud_archive()}</strong><small>{m.cloud_archive_hint()}</small></span>
        </button>
      </div>
    </section>

    <section class="danger-zone">
      <header><Trash2 size={15} /><div><h3>{m.cloud_danger_zone()}</h3><p>{m.cloud_danger_zone_hint()}</p></div></header>
      <div class="danger-row"><div><strong>{m.cloud_destroy_workspace()}</strong><span>{m.cloud_destroy_workspace_hint()}</span></div><button disabled={action !== null} onclick={() => void remove()}>{#if action === 'destroy'}<Loader2 size={14} class="animate-spin" />{/if}{m.cloud_destroy()}</button></div>
    </section>
  {/if}
</main>

<style>
  .page { height:100%; overflow-y:auto; padding:1.25rem; }
  .page > :global(*) { max-width:52rem; margin-left:auto; margin-right:auto; }
  .loading { min-height:16rem; display:grid; place-items:center; color:var(--color-muted); font-size:.75rem; }
  .intro { margin-bottom:1rem; }
  .eyebrow { color:var(--color-accent); font:600 .55rem/1 var(--font-mono,monospace); letter-spacing:.11em; text-transform:uppercase; }
  h2 { margin:.45rem 0 .25rem; font-size:1.25rem; letter-spacing:-.025em; }
  .intro p, header p { margin:0; color:var(--color-muted); font-size:.68rem; line-height:1.45; }
  .alert { margin-bottom:.75rem; padding:.65rem .75rem; border:1px solid; border-radius:var(--radius-md); font-size:.7rem; }
  .alert.error { border-color:color-mix(in srgb,var(--color-destructive) 30%,transparent); color:var(--color-destructive); background:color-mix(in srgb,var(--color-destructive) 8%,transparent); }
  .alert.success { border-color:color-mix(in srgb,var(--color-success) 30%,transparent); color:var(--color-success); background:color-mix(in srgb,var(--color-success) 8%,transparent); }
  section { margin-bottom:.75rem; border:1px solid var(--hairline); border-radius:var(--radius-md); overflow:hidden; background:var(--elevation-1-bg); }
  section > header { min-height:3.35rem; padding:.65rem .8rem; display:flex; align-items:center; gap:.65rem; border-bottom:1px solid var(--hairline); }
  section > header > :global(svg) { color:var(--color-accent); }
  h3 { margin:0 0 .18rem; font-size:.75rem; }
  dl { margin:0; padding:.3rem .8rem; }
  dl div { min-height:2.25rem; display:flex; align-items:center; gap:1rem; border-bottom:1px solid color-mix(in srgb,var(--hairline) 60%,transparent); }
  dl div:last-child { border:0; }
  dt { color:var(--color-muted); font-size:.63rem; }
  dd { margin-left:auto; text-align:right; font:.63rem/1.3 var(--font-mono,monospace); }
  .runtime-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:.5rem; padding:.75rem; }
  .runtime-grid > div { min-height:2.6rem; padding:.55rem .65rem; display:grid; grid-template-columns:auto 1fr; align-content:center; column-gap:.5rem; border:1px solid var(--hairline); border-radius:var(--radius-md); background:var(--elevation-2-bg); }
  .status-dot { width:.4rem;height:.4rem;border-radius:50%;background:var(--color-success);box-shadow:0 0 .45rem var(--color-success); }
  .status-dot.base { background:var(--color-accent);box-shadow:none; }
  .runtime-grid strong { font:.66rem/1 var(--font-mono,monospace); }
  .runtime-grid small { grid-column:2;margin-top:.25rem;color:var(--color-muted);font-size:.53rem;text-transform:uppercase;letter-spacing:.06em; }
  .actions { display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;padding:.75rem; }
  .actions button { min-height:3.5rem;padding:.6rem .7rem;display:flex;align-items:flex-start;gap:.55rem;text-align:left;border:1px solid var(--hairline);border-radius:var(--radius-md);background:var(--elevation-2-bg);color:var(--color-foreground);cursor:pointer; }
  .actions button:hover:not(:disabled){border-color:color-mix(in srgb,var(--color-accent) 35%,transparent)}
  .actions button:disabled{opacity:.45;cursor:not-allowed}.actions button>span{display:flex;flex-direction:column}.actions strong{font-size:.65rem}.actions small{margin-top:.25rem;color:var(--color-muted);font-size:.55rem;line-height:1.35}
  .danger-zone { border-color:color-mix(in srgb,var(--color-destructive) 25%,var(--hairline)); }
  .danger-zone > header > :global(svg) { color:var(--color-destructive); }
  .danger-row { padding:.75rem .8rem;display:flex;align-items:center;gap:1rem; }.danger-row>div{display:flex;flex-direction:column}.danger-row strong{font-size:.68rem}.danger-row span{margin-top:.25rem;color:var(--color-muted);font-size:.58rem}.danger-row button{margin-left:auto;height:2rem;padding:0 .7rem;display:flex;align-items:center;gap:.35rem;border:1px solid color-mix(in srgb,var(--color-destructive) 40%,transparent);border-radius:var(--radius-md);background:color-mix(in srgb,var(--color-destructive) 8%,transparent);color:var(--color-destructive);font-size:.63rem;font-weight:650;cursor:pointer}
  @media(max-width:44rem){.actions,.runtime-grid{grid-template-columns:1fr}.danger-row{align-items:flex-start;flex-direction:column}.danger-row button{margin-left:0}}
</style>
