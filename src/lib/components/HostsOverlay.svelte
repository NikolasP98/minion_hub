<script lang="ts">
  import { hostsState, getActiveHost, loadHosts, saveHosts } from '$lib/state/hosts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { fmtTimeAgo } from '$lib/utils/format';
  import { uuid } from '$lib/utils/uuid';
  import type { Host } from '$lib/types/host';

  let formName = $state('');
  let formUrl = $state('');
  let formToken = $state('');
  let editingId = $state<string | null>(null);
  let confirmDeleteId = $state<string | null>(null);

  function close() { ui.overlayOpen = false; editingId = null; confirmDeleteId = null; }

  function startEdit(host: Host) {
    editingId = host.id;
    formName = host.name;
    formUrl = host.url;
    formToken = host.token;
  }

  function cancelEdit() { editingId = null; formName = ''; formUrl = ''; formToken = ''; }

  function saveHost() {
    if (!formUrl.trim()) return;
    const name = formName.trim() || (() => { try { return new URL(formUrl).hostname; } catch { return 'host'; } })();
    if (editingId) {
      const h = hostsState.hosts.find((x) => x.id === editingId);
      if (h) { h.name = name; h.url = formUrl.trim(); h.token = formToken.trim(); }
    } else {
      hostsState.hosts.push({ id: uuid(), name, url: formUrl.trim(), token: formToken.trim(), lastConnectedAt: null });
      hostsState.activeHostId = hostsState.hosts[hostsState.hosts.length - 1].id;
    }
    saveHosts();
    cancelEdit();
    if (!editingId) { close(); wsConnect(); }
  }

  function deleteHost(id: string) {
    hostsState.hosts = hostsState.hosts.filter((h) => h.id !== id);
    saveHosts();
    if (hostsState.activeHostId === id) {
      wsDisconnect();
      hostsState.activeHostId = hostsState.hosts[0]?.id ?? null;
    }
    confirmDeleteId = null;
  }

  function connectTo(id: string) {
    if (hostsState.activeHostId === id && conn.connected) { close(); return; }
    wsDisconnect();
    hostsState.activeHostId = id;
    wsConnect();
    close();
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" onclick={close}>
  <div class="panel" onclick={(e) => e.stopPropagation()}>
    <div class="panel-header">
      <span class="panel-title">Manage Hosts</span>
      <button class="close-btn" onclick={close} aria-label="Close">×</button>
    </div>
    <div class="panel-body">
      {#each hostsState.hosts as host (host.id)}
        <div class="host-card {editingId === host.id ? 'editing' : ''}">
          <div class="card-info">
            <div class="card-name">
              {host.name}
              {#if host.id === hostsState.activeHostId && conn.connected}
                <span class="badge-connected">connected</span>
              {/if}
            </div>
            <div class="card-url">{host.url}</div>
            <div class="card-last">Last: {fmtTimeAgo(host.lastConnectedAt)}</div>
            {#if confirmDeleteId === host.id}
              <div class="confirm-row">
                Delete this host?
                <button onclick={() => deleteHost(host.id)}>Delete</button>
                <button class="cancel-btn" onclick={() => confirmDeleteId = null}>Cancel</button>
              </div>
            {/if}
          </div>
          <div class="card-actions">
            <button class="card-btn" onclick={() => connectTo(host.id)}>Connect</button>
            <button class="card-btn" onclick={() => startEdit(host)}>Edit</button>
            <button class="card-btn danger" onclick={() => confirmDeleteId = host.id}>Delete</button>
          </div>
        </div>
      {/each}
    </div>
    <div class="hosts-form">
      <div class="form-title">{editingId ? 'Edit Host' : 'Add Host'}</div>
      <div class="form-fields">
        <div class="form-field">
          <label>Name</label>
          <input type="text" bind:value={formName} placeholder="protopi" />
        </div>
        <div class="form-field">
          <label>Token</label>
          <input type="password" bind:value={formToken} placeholder="••••••" />
        </div>
        <div class="form-field full-width">
          <label>WebSocket URL</label>
          <input type="text" bind:value={formUrl} placeholder="wss://host.ts.net" />
        </div>
      </div>
      <div class="form-actions">
        {#if editingId}
          <button class="cancel-btn" onclick={cancelEdit}>Cancel</button>
        {/if}
        <button class="save-btn" onclick={saveHost}>{editingId ? 'Save' : 'Add & Connect'}</button>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
  }
  .panel {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 12px; width: 520px;
    max-width: calc(100vw - 40px); max-height: 80vh;
    display: flex; flex-direction: column; box-shadow: var(--shadow);
  }
  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .panel-title { font-size: 16px; font-weight: 700; }
  .close-btn {
    background: none; border: none; color: var(--text3);
    cursor: pointer; font-size: 20px; line-height: 1;
    padding: 2px 6px; border-radius: 4px; transition: color 0.2s;
  }
  .close-btn:hover { color: var(--text); }
  .panel-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
  .host-card {
    background: var(--bg3); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;
    display: flex; align-items: flex-start; gap: 12px;
  }
  .host-card.editing { border-color: var(--accent); }
  .card-info { flex: 1; min-width: 0; }
  .card-name {
    font-size: 14px; font-weight: 600;
    display: flex; align-items: center; gap: 8px;
  }
  .card-url {
    font-size: 11px; color: var(--text3); font-family: monospace;
    margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .card-last { font-size: 10px; color: var(--text3); margin-top: 4px; }
  .card-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .card-btn {
    background: none; border: 1px solid var(--border); border-radius: 5px;
    color: var(--text3); cursor: pointer; font-size: 13px;
    padding: 4px 8px; transition: all 0.15s;
  }
  .card-btn:hover { border-color: var(--text2); color: var(--text); }
  .card-btn.danger:hover { border-color: var(--red); color: var(--red); }
  .confirm-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 0 0; font-size: 12px; color: var(--amber);
  }
  .confirm-row button {
    background: var(--red); border: none; border-radius: 4px;
    color: #fff; cursor: pointer; font-size: 11px; font-weight: 600; padding: 3px 10px;
  }
  .badge-connected {
    font-size: 10px; font-weight: 600;
    background: rgba(34,197,94,0.12); color: var(--green);
    border: 1px solid rgba(34,197,94,0.25); border-radius: 8px; padding: 1px 7px;
  }
  .hosts-form {
    border-top: 1px solid var(--border);
    padding: 14px 16px; flex-shrink: 0;
  }
  .form-title {
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.6px; color: var(--text3); margin-bottom: 10px;
  }
  .form-fields {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 8px; margin-bottom: 10px;
  }
  .form-field { display: flex; flex-direction: column; gap: 4px; }
  .form-field.full-width { grid-column: 1 / -1; }
  .form-field label { font-size: 11px; color: var(--text3); }
  .form-field input {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 5px;
    color: var(--text); padding: 5px 9px; font-family: inherit; font-size: 12px;
    outline: none; transition: border-color 0.2s;
  }
  .form-field input:focus { border-color: var(--accent); }
  .form-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .save-btn {
    background: var(--accent); border: none; border-radius: 5px;
    color: #fff; cursor: pointer; font-family: inherit; font-size: 12px;
    font-weight: 600; padding: 6px 16px; transition: filter 0.2s;
  }
  .save-btn:hover { filter: brightness(1.15); }
  .cancel-btn {
    background: none; border: 1px solid var(--border); border-radius: 5px;
    color: var(--text3); cursor: pointer; font-family: inherit;
    font-size: 12px; padding: 6px 12px; transition: color 0.2s;
  }
  .cancel-btn:hover { color: var(--text2); }
</style>
