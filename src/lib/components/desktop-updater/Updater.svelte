<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Spinner } from '@minion-stack/ui';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import * as m from '../../paraglide/messages';

  interface Status {
    revision: number;
    phase: 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'failed';
    version: string | null;
    percent: number | null;
    manual: boolean;
    installerUrl: string | null;
  }
  let status: Status = $state({
    revision: 0,
    phase: 'checking',
    version: null,
    percent: null,
    manual: false,
    installerUrl: null,
  });
  let busy = $state(false);
  const working = $derived(['checking', 'downloading', 'installing'].includes(status.phase));
  const text = $derived(
    {
      checking: m.desktop_update_checking(),
      current: m.desktop_update_current(),
      available: m.desktop_update_available({ version: status.version ?? '' }),
      downloading: m.desktop_update_downloading(),
      installing: m.desktop_update_installing(),
      failed: m.desktop_update_failed(),
    }[status.phase],
  );

  function accept(value: Status) {
    if (value.revision >= status.revision) status = value;
  }
  async function action(
    command:
      | 'desktop_update_install'
      | 'desktop_update_check'
      | 'desktop_update_continue'
      | 'desktop_update_download',
  ) {
    busy = true;
    try {
      await invoke(command, { revision: status.revision });
    } catch {
      try {
        const current = await invoke<Status>('desktop_update_status');
        accept(current);
        if (!['checking', 'downloading', 'installing'].includes(current.phase))
          status = { ...current, phase: 'failed' };
      } catch {
        status = { ...status, phase: 'failed' };
      }
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const stop = await listen<Status>('desktop-update', (event) => accept(event.payload));
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        const value = await invoke<Status>('desktop_update_status');
        if (!disposed) accept(value);
      } catch {
        if (!disposed) status = { ...status, phase: 'failed' };
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  });
</script>

<main aria-busy={working}>
  <h1 class="t-heading">Minion Hub</h1>
  <div class="status" role="status" aria-live="polite">
    {#if working}<Spinner size="sm" />{/if}
    <p class="t-body">{text}</p>
  </div>
  {#if status.phase === 'downloading'}
    <progress
      max="100"
      value={status.percent ?? undefined}
      aria-label={m.desktop_update_downloading()}
    ></progress>
    {#if status.percent !== null}<p class="t-caption">{status.percent}%</p>{/if}
  {/if}
  {#if status.phase === 'available'}
    <p class="t-body">
      {status.manual ? m.desktop_update_package() : m.desktop_update_restart_hint()}
    </p>
  {/if}
  <div class="actions">
    {#if status.phase === 'available' && !status.manual}
      <Button
        variant="primary"
        size="touch"
        loading={busy}
        onclick={() => void action('desktop_update_install')}>{m.desktop_update_install()}</Button
      >
    {:else if status.phase === 'available' && status.installerUrl}
      <Button variant="primary" size="touch" onclick={() => void action('desktop_update_download')}
        >{m.desktop_update_download()}</Button
      >
    {:else if status.phase === 'failed' || status.phase === 'current'}
      <Button size="touch" loading={busy} onclick={() => void action('desktop_update_check')}
        >{m.desktop_update_retry()}</Button
      >
    {/if}
    {#if status.phase !== 'installing'}
      <Button size="touch" variant="ghost" onclick={() => void action('desktop_update_continue')}
        >{m.desktop_update_continue()}</Button
      >
    {/if}
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
  }
  h1,
  p {
    margin: 0;
  }
  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  progress {
    width: 100%;
    accent-color: var(--color-accent);
  }
</style>
