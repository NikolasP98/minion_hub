<script lang="ts">
  import { page } from '$app/state';
  import {
    Cpu,
    HardDrive,
    MemoryStick,
    Monitor,
    PackageCheck,
    Server,
    SquareTerminal,
  } from 'lucide-svelte';
  import { refreshCloud, cloudShell, cloudState } from '$lib/state/features/cloud.svelte';
  import {
    AsyncBoundary,
    PageBody,
    PageShell,
    type AsyncBoundaryState,
  } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  const { data } = $props();
  const selected = $derived(cloudShell(page.url.searchParams.get('server')));
  const suffix = $derived(selected ? `?server=${encodeURIComponent(selected.shellId)}` : '');

  const pageState = $derived.by<AsyncBoundaryState>(() => {
    if (cloudState.loading) return { kind: 'loading', label: m.common_loading() };
    if (cloudState.error && cloudState.shells.length === 0) {
      return {
        kind: 'error',
        title: m.cloud_load_failed(),
        description: cloudState.error,
        retry: () => void refreshCloud(),
      };
    }
    if (!selected) {
      return {
        kind: 'empty',
        title: m.cloud_empty_title(),
        description: m.cloud_empty_description(),
      };
    }
    return { kind: 'ready' };
  });

  function date(value: number | null): string {
    return value ? new Date(value).toLocaleString() : m.cloud_never();
  }
</script>

<svelte:head><title>{m.cloud_overview_title()} · Minion hub</title></svelte:head>

<PageShell archetype="dashboard" scroll="none" labelledBy="cloud-overview-title">
  <h1 id="cloud-overview-title" class="sr-only">{m.cloud_overview_title()}</h1>
  <PageBody width="content" padding="compact" scroll="region" class="cloud-overview-body">
    <AsyncBoundary state={pageState} class="cloud-overview-boundary">
      {#if selected}
        <section class="hero" aria-labelledby="cloud-workspace-name">
          <div class="hero-copy">
            <span class="kicker">{m.cloud_provider_exedev()} / {selected.vmName}</span>
            <h2 id="cloud-workspace-name">{selected.displayName}</h2>
            <p>{m.cloud_workspace_description()}</p>
            <div class="status-line">
              <span class="status-dot status-{selected.status}" aria-hidden="true"></span>
              <strong>{selected.status}</strong>
              <span aria-hidden="true">·</span>
              <span>{selected.provider ?? 'exe.dev'}</span>
              <span aria-hidden="true">·</span>
              <span>{selected.region}</span>
            </div>
          </div>
          <div class="machine-glyph" aria-hidden="true">
            <Server size={38} strokeWidth={1.2} /><span>01</span>
          </div>
        </section>

        <section class="spec-grid" aria-label={m.cloud_machine_specs()}>
          <div class="spec-card">
            <Cpu size={16} aria-hidden="true" />
            <span>{selected.cpu ?? 2}</span><small>{m.cloud_vcpu()}</small>
          </div>
          <div class="spec-card">
            <MemoryStick size={16} aria-hidden="true" />
            <span>{Math.round(selected.memoryMB / 1024)} GB</span><small>{m.cloud_memory()}</small>
          </div>
          <div class="spec-card">
            <HardDrive size={16} aria-hidden="true" />
            <span>{selected.diskGB} GB</span><small>{m.cloud_storage()}</small>
          </div>
          <div class="spec-card">
            <PackageCheck size={16} aria-hidden="true" />
            <span>{selected.runtimes?.length ?? 1}</span><small>{m.cloud_runtimes()}</small>
          </div>
        </section>

        <section class="content-grid">
          <div class="panel access-panel">
            <div class="panel-head">
              <h3>{m.cloud_quick_access()}</h3>
              <small>{m.cloud_secure_sessions()}</small>
            </div>
            <div class="access-grid">
              {#if data.canConnect}
                <a href={`/cloud/gui${suffix}`}>
                  <span class="access-icon"><Monitor size={18} aria-hidden="true" /></span>
                  <span>
                    <strong>{m.cloud_open_gui()}</strong><small>{m.cloud_open_gui_hint()}</small>
                  </span>
                  <b aria-hidden="true">↗</b>
                </a>
                <a href={`/cloud/terminal${suffix}`}>
                  <span class="access-icon"><SquareTerminal size={18} aria-hidden="true" /></span>
                  <span>
                    <strong>{m.cloud_open_terminal()}</strong><small
                      >{m.cloud_open_terminal_hint()}</small
                    >
                  </span>
                  <b aria-hidden="true">↗</b>
                </a>
              {:else}
                <div class="locked" role="note">{m.cloud_connect_permission_required()}</div>
              {/if}
            </div>
          </div>

          <div class="panel detail-panel">
            <div class="panel-head">
              <h3>{m.cloud_runtime_stack()}</h3>
              <small>minion-workstation-v1</small>
            </div>
            <div class="runtime-list">
              {#each selected.runtimes ?? [selected.harness] as runtime (runtime)}
                <span><i aria-hidden="true"></i>{runtime}</span>
              {/each}
              <span
                ><i class="base" aria-hidden="true"></i>{m.cloud_package_chromium()}
                <em>{m.cloud_base()}</em></span
              >
            </div>
            <dl>
              <div>
                <dt>{m.cloud_os_profile()}</dt>
                <dd>{m.cloud_os_profile_value()}</dd>
              </div>
              <div>
                <dt>{m.cloud_created()}</dt>
                <dd>{date(selected.createdAt)}</dd>
              </div>
              <div>
                <dt>{m.cloud_last_activity()}</dt>
                <dd>{date(selected.lastInvokeAt)}</dd>
              </div>
              <div>
                <dt>{m.cloud_backup_policy()}</dt>
                <dd>{selected.backupCadence}</dd>
              </div>
            </dl>
          </div>
        </section>
      {/if}
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  :global(.cloud-overview-body),
  :global(.cloud-overview-boundary) {
    min-height: 100%;
  }

  .hero {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-section);
    padding: var(--space-section);
    overflow: hidden;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: linear-gradient(to right, var(--color-surface-2), var(--color-surface-1));
    box-shadow: var(--shadow-sm);
  }

  .hero-copy {
    position: relative;
    z-index: var(--layer-base);
    min-width: 0;
  }

  .kicker,
  .status-line,
  .panel-head small,
  dd,
  .runtime-list span {
    font-family: var(--font-mono);
  }

  .kicker {
    color: var(--color-accent);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  h2 {
    margin: var(--space-2) 0 var(--space-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-display);
    line-height: var(--line-height-display);
    letter-spacing: var(--letter-spacing-display);
  }

  .hero p {
    max-width: 48ch;
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
    line-height: var(--line-height-body);
  }

  .status-line {
    display: flex;
    margin-top: var(--space-3);
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .status-line strong {
    color: var(--color-text-primary);
  }

  .status-dot,
  .runtime-list i {
    width: var(--space-2);
    height: var(--space-2);
    flex: none;
    border-radius: var(--radius-full);
    background: var(--color-text-disabled);
  }

  .status-online,
  .runtime-list i {
    background: var(--color-success-fg);
  }

  .status-provisioning {
    background: var(--color-warning-fg, var(--color-warning));
    animation: cloud-status-pulse var(--duration-slow) var(--ease-standard) infinite alternate;
  }

  .status-error {
    background: var(--color-danger-fg);
  }

  .machine-glyph {
    position: relative;
    display: grid;
    width: calc(var(--space-page-section) * 2);
    height: calc(var(--space-page-section) * 2);
    margin-left: auto;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border-default));
    border-radius: var(--radius-full);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 5%, var(--color-surface-1));
    box-shadow: var(--shadow-md);
  }

  .machine-glyph span {
    position: absolute;
    right: var(--space-2);
    bottom: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--font-size-telemetry);
    font-weight: var(--font-weight-bold);
  }

  .spec-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-top: var(--space-3);
    overflow: hidden;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }

  .spec-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-content: center;
    gap: var(--space-1) var(--space-2);
    padding: var(--space-3) var(--space-4);
    color: var(--color-text-tertiary);
  }

  .spec-card + .spec-card {
    border-left: 1px solid var(--color-border-subtle);
  }

  .spec-card span {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
  }

  .spec-card small {
    grid-column: 2;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .content-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .panel {
    overflow: hidden;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }

  .panel-head {
    display: flex;
    min-height: var(--control-height-lg);
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .panel-head h3 {
    margin: 0;
    font-size: var(--font-size-label);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .panel-head small {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
  }

  .access-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .access-grid a {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    text-decoration: none;
    transition:
      transform var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard);
  }

  .access-grid a:hover {
    transform: translateY(calc(-1 * var(--space-0-5)));
    border-color: color-mix(in srgb, var(--color-accent) 42%, var(--color-border-default));
  }

  .access-icon {
    display: grid;
    width: var(--control-height-lg);
    height: var(--control-height-lg);
    flex: none;
    place-items: center;
    border-radius: var(--radius-md);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }

  .access-grid a > span:nth-child(2) {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .access-grid strong {
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .access-grid small {
    margin-top: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
  }

  .access-grid b {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-weight: var(--font-weight-regular);
  }

  .locked {
    grid-column: 1 / -1;
    padding: var(--space-section);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    text-align: center;
  }

  .runtime-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .runtime-list span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    font-size: var(--font-size-telemetry);
  }

  .runtime-list i.base {
    background: var(--color-accent);
  }

  .runtime-list em {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    font-style: normal;
    text-transform: uppercase;
  }

  dl {
    margin: 0;
    padding: var(--space-1) var(--space-3);
  }

  dl div {
    display: flex;
    min-height: var(--control-height-md);
    align-items: center;
    gap: var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  dl div:last-child {
    border-bottom: 0;
  }

  dt,
  dd {
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
  }

  dt {
    color: var(--color-text-tertiary);
  }

  dd {
    margin-left: auto;
    color: var(--color-text-secondary);
    text-align: right;
  }

  @keyframes cloud-status-pulse {
    to {
      opacity: 0.4;
    }
  }

  @media (max-width: 899.98px) {
    .content-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .spec-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .spec-card:nth-child(3) {
      border-top: 1px solid var(--color-border-subtle);
      border-left: 0;
    }

    .spec-card:nth-child(4) {
      border-top: 1px solid var(--color-border-subtle);
    }
  }

  @media (max-width: 599.98px) {
    .hero {
      padding: var(--space-4);
    }

    .machine-glyph {
      display: none;
    }

    .access-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
