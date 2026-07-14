<script lang="ts">
  import { page } from '$app/state';
  import { Cloud, Cpu, HardDrive, MemoryStick, Monitor, PackageCheck, Server, SquareTerminal } from 'lucide-svelte';
  import CloudEmpty from '$lib/components/cloud/CloudEmpty.svelte';
  import { cloudShell, cloudState } from '$lib/state/features/cloud.svelte';
  import * as m from '$lib/paraglide/messages';

  const { data } = $props();
  const selected = $derived(cloudShell(page.url.searchParams.get('server')));
  const suffix = $derived(selected ? `?server=${encodeURIComponent(selected.shellId)}` : '');

  function date(value: number | null): string {
    return value ? new Date(value).toLocaleString() : m.cloud_never();
  }
</script>

<svelte:head><title>{m.cloud_overview_title()} · Minion hub</title></svelte:head>

<main class="page">
  {#if cloudState.loading}
    <div class="loading">{m.common_loading()}</div>
  {:else if cloudState.error && cloudState.shells.length === 0}
    <div class="error-panel"><Cloud size={22} /><strong>{m.cloud_load_failed()}</strong><span>{cloudState.error}</span></div>
  {:else if !selected}
    <CloudEmpty canManage={data.canManage ?? false} />
  {:else}
    <section class="hero">
      <div class="hero-copy">
        <span class="kicker">{m.cloud_provider_exedev()} / {selected.vmName}</span>
        <h2>{selected.displayName}</h2>
        <p>{m.cloud_workspace_description()}</p>
        <div class="status-line"><span class="status-dot status-{selected.status}"></span><strong>{selected.status}</strong><span>·</span><span>{selected.provider ?? 'exe.dev'}</span><span>·</span><span>{selected.region}</span></div>
      </div>
      <div class="machine-glyph" aria-hidden="true"><Server size={38} strokeWidth={1.2} /><span>01</span></div>
    </section>

    <section class="spec-grid" aria-label={m.cloud_machine_specs()}>
      <div class="spec-card"><Cpu size={16} /><span>{selected.cpu ?? 2}</span><small>{m.cloud_vcpu()}</small></div>
      <div class="spec-card"><MemoryStick size={16} /><span>{Math.round(selected.memoryMB / 1024)} GB</span><small>{m.cloud_memory()}</small></div>
      <div class="spec-card"><HardDrive size={16} /><span>{selected.diskGB} GB</span><small>{m.cloud_storage()}</small></div>
      <div class="spec-card"><PackageCheck size={16} /><span>{selected.runtimes?.length ?? 1}</span><small>{m.cloud_runtimes()}</small></div>
    </section>

    <section class="content-grid">
      <div class="panel access-panel">
        <div class="panel-head"><span>{m.cloud_quick_access()}</span><small>{m.cloud_secure_sessions()}</small></div>
        <div class="access-grid">
          {#if data.canConnect}
            <a href={`/cloud/gui${suffix}`}><span class="access-icon"><Monitor size={18} /></span><span><strong>{m.cloud_open_gui()}</strong><small>{m.cloud_open_gui_hint()}</small></span><b>↗</b></a>
            <a href={`/cloud/terminal${suffix}`}><span class="access-icon"><SquareTerminal size={18} /></span><span><strong>{m.cloud_open_terminal()}</strong><small>{m.cloud_open_terminal_hint()}</small></span><b>↗</b></a>
          {:else}
            <div class="locked">{m.cloud_connect_permission_required()}</div>
          {/if}
        </div>
      </div>

      <div class="panel detail-panel">
        <div class="panel-head"><span>{m.cloud_runtime_stack()}</span><small>minion-workstation-v1</small></div>
        <div class="runtime-list">
          {#each selected.runtimes ?? [selected.harness] as runtime (runtime)}
            <span><i></i>{runtime}</span>
          {/each}
          <span><i class="base"></i>{m.cloud_package_chromium()} <em>{m.cloud_base()}</em></span>
        </div>
        <dl>
          <div><dt>{m.cloud_os_profile()}</dt><dd>{m.cloud_os_profile_value()}</dd></div>
          <div><dt>{m.cloud_created()}</dt><dd>{date(selected.createdAt)}</dd></div>
          <div><dt>{m.cloud_last_activity()}</dt><dd>{date(selected.lastInvokeAt)}</dd></div>
          <div><dt>{m.cloud_backup_policy()}</dt><dd>{selected.backupCadence}</dd></div>
        </dl>
      </div>
    </section>
  {/if}
</main>

<style>
  .page { height: 100%; overflow-y: auto; padding: 1.1rem; background: radial-gradient(circle at 72% 4%, color-mix(in srgb,var(--color-accent) 5%,transparent), transparent 28%); }
  .loading, .error-panel { min-height: 18rem; display: grid; place-items: center; align-content: center; gap: .5rem; color: var(--color-muted); font-size: .75rem; text-align: center; }
  .error-panel strong { color: var(--color-foreground); }
  .error-panel span { max-width: 34rem; font: .65rem/1.5 var(--font-mono,monospace); }
  .hero { position: relative; min-height: 9.5rem; padding: 1.25rem 1.4rem; display: flex; align-items: center; overflow: hidden; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: linear-gradient(120deg,var(--elevation-2-bg),var(--elevation-1-bg)); }
  .hero::after { content:''; position:absolute; inset:0; pointer-events:none; background: repeating-linear-gradient(90deg, transparent 0 47px, color-mix(in srgb,var(--hairline) 55%,transparent) 48px); mask-image: linear-gradient(90deg,transparent 35%,black); }
  .hero-copy { position: relative; z-index: 1; }
  .kicker { color: var(--color-accent); font: 600 .56rem/1 var(--font-mono,monospace); letter-spacing: .12em; }
  h2 { margin: .55rem 0 .3rem; font-size: 1.65rem; line-height: 1; letter-spacing: -.04em; }
  .hero p { margin: 0; max-width: 32rem; color: var(--color-muted); font-size: .75rem; line-height: 1.5; }
  .status-line { margin-top: .8rem; display: flex; align-items: center; gap: .4rem; color: var(--color-muted); font: .6rem/1 var(--font-mono,monospace); text-transform: uppercase; letter-spacing: .06em; }
  .status-line strong { color: var(--color-foreground); }
  .status-dot { width: .42rem; height: .42rem; border-radius: 50%; background: var(--color-muted); }
  .status-online { background: var(--color-success); box-shadow: 0 0 .6rem var(--color-success); }
  .status-provisioning { background: var(--color-warning); animation: pulse 1.2s infinite; }
  .status-error { background: var(--color-destructive); }
  .machine-glyph { position: relative; z-index:1; margin-left:auto; margin-right: 2.5rem; width: 5rem; height: 5rem; display:grid; place-items:center; border:1px solid color-mix(in srgb,var(--color-accent) 30%,var(--hairline)); border-radius:50%; color:var(--color-accent); box-shadow: 0 0 0 .8rem color-mix(in srgb,var(--color-accent) 3%,transparent); }
  .machine-glyph span { position:absolute; bottom:.55rem; right:.4rem; font:700 .5rem/1 var(--font-mono,monospace); }
  .spec-grid { display:grid; grid-template-columns:repeat(4,1fr); margin-top:.75rem; border:1px solid var(--hairline); border-radius:var(--radius-md); overflow:hidden; background:var(--elevation-1-bg); }
  .spec-card { min-height:4.1rem; display:grid; grid-template-columns:auto 1fr; align-content:center; column-gap:.55rem; padding:.7rem .85rem; color:var(--color-muted); }
  .spec-card + .spec-card { border-left:1px solid var(--hairline); }
  .spec-card span { color:var(--color-foreground); font:650 .9rem/1 var(--font-mono,monospace); }
  .spec-card small { grid-column:2; margin-top:.25rem; font-size:.53rem; text-transform:uppercase; letter-spacing:.1em; }
  .content-grid { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(18rem,.8fr); gap:.75rem; margin-top:.75rem; }
  .panel { border:1px solid var(--hairline); border-radius:var(--radius-md); overflow:hidden; background:var(--elevation-1-bg); }
  .panel-head { height:2.35rem; padding:0 .8rem; display:flex; align-items:center; border-bottom:1px solid var(--hairline); }
  .panel-head span { font-size:.67rem; font-weight:650; text-transform:uppercase; letter-spacing:.08em; }
  .panel-head small { margin-left:auto; color:var(--color-muted); font: .54rem/1 var(--font-mono,monospace); }
  .access-grid { display:grid; grid-template-columns:1fr 1fr; gap:.65rem; padding:.75rem; }
  .access-grid a { min-height:4.6rem; padding:.75rem; display:flex; align-items:center; gap:.65rem; border:1px solid var(--hairline); border-radius:var(--radius-md); color:var(--color-foreground); text-decoration:none; background:var(--elevation-2-bg); transition:transform .15s,border-color .15s; }
  .access-grid a:hover { transform:translateY(-1px); border-color:color-mix(in srgb,var(--color-accent) 42%,transparent); }
  .access-icon { width:2.25rem; height:2.25rem; display:grid; place-items:center; border-radius:var(--radius-md); color:var(--color-accent); background:color-mix(in srgb,var(--color-accent) 10%,transparent); }
  .access-grid a > span:nth-child(2) { display:flex; flex-direction:column; min-width:0; }
  .access-grid strong { font-size:.72rem; }
  .access-grid small { margin-top:.25rem; color:var(--color-muted); font-size:.58rem; }
  .access-grid b { margin-left:auto; color:var(--color-muted); font-weight:400; }
  .locked { grid-column:1/-1; min-height:4.6rem; display:grid; place-items:center; color:var(--color-muted); font-size:.7rem; }
  .runtime-list { display:flex; flex-wrap:wrap; gap:.4rem; padding:.75rem; border-bottom:1px solid var(--hairline); }
  .runtime-list span { display:flex; align-items:center; gap:.4rem; padding:.3rem .45rem; border:1px solid var(--hairline); border-radius:999px; font:.58rem/1 var(--font-mono,monospace); }
  .runtime-list i { width:.35rem;height:.35rem;border-radius:50%;background:var(--color-success); }
  .runtime-list i.base { background:var(--color-accent); }
  .runtime-list em { color:var(--color-muted);font-style:normal;font-size:.48rem;text-transform:uppercase; }
  dl { margin:0;padding:.35rem .8rem .55rem; }
  dl div { min-height:1.85rem;display:flex;align-items:center;gap:.75rem;border-bottom:1px solid color-mix(in srgb,var(--hairline) 55%,transparent); }
  dl div:last-child { border-bottom:0; }
  dt { color:var(--color-muted);font-size:.58rem; }
  dd { margin-left:auto;font:.58rem/1 var(--font-mono,monospace);text-align:right; }
  @keyframes pulse { 50% { opacity:.35; } }
  @media(max-width:56rem){.content-grid{grid-template-columns:1fr}.machine-glyph{margin-right:.5rem}.spec-grid{grid-template-columns:1fr 1fr}.spec-card:nth-child(3){border-left:0;border-top:1px solid var(--hairline)}.spec-card:nth-child(4){border-top:1px solid var(--hairline)}}
  @media(max-width:38rem){.machine-glyph{display:none}.access-grid{grid-template-columns:1fr}}
</style>
