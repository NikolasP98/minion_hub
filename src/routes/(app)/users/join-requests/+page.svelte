<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  const { data } = $props();
  let busy = $state<string | null>(null);

  async function approve(id: string, organizationId: string, role: string) {
    busy = id;
    await fetch(`/api/join-requests/${id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId, role }) });
    busy = null; await invalidateAll();
  }
  async function deny(id: string) {
    busy = id;
    await fetch(`/api/join-requests/${id}/deny`, { method: 'POST' });
    busy = null; await invalidateAll();
  }
  let linkOrg = $state(data.orgs[0]?.id ?? '');
  let linkRole = $state('user');
  let createdUrl = $state<string | null>(null);
  async function mintLink() {
    const res = await fetch('/api/join-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: linkOrg, role: linkRole }) });
    if (res.ok) { createdUrl = (await res.json()).url; await invalidateAll(); }
  }
  async function revoke(id: string) { await fetch(`/api/join-links/${id}/revoke`, { method: 'POST' }); await invalidateAll(); }
</script>

<div class="p-6 space-y-8">
  <section>
    <h1 class="text-lg font-semibold mb-3">Pending join requests</h1>
    {#if data.requests.length === 0}
      <p class="text-sm text-muted">No pending requests.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.requests as r (r.id)}
          <li class="flex items-center justify-between gap-3 border border-border rounded px-3 py-2">
            <div>
              <div class="text-sm text-foreground">{r.display_name ?? r.email}</div>
              <div class="text-xs text-muted">{r.email}{#if r.message} — "{r.message}"{/if}</div>
            </div>
            <div class="flex items-center gap-2">
              <select class="bg-bg border border-border rounded px-2 py-1 text-xs" bind:value={r.requested_role}>
                <option value="user">user</option><option value="admin">admin</option><option value="super_admin">super_admin</option>
              </select>
              <button disabled={busy === r.id} onclick={() => approve(r.id, r.organization_id, r.requested_role)} class="px-3 py-1 rounded border text-xs bg-accent/20 border-accent/30 text-accent">Approve</button>
              <button disabled={busy === r.id} onclick={() => deny(r.id)} class="px-3 py-1 rounded border text-xs text-red-400 border-red-400/30">Deny</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2 class="text-base font-semibold mb-3">Join links</h2>
    <div class="flex items-center gap-2 mb-3">
      <select class="bg-bg border border-border rounded px-2 py-1 text-xs" bind:value={linkOrg}>
        {#each data.orgs as o}<option value={o.id}>{o.name}</option>{/each}
      </select>
      <select class="bg-bg border border-border rounded px-2 py-1 text-xs" bind:value={linkRole}>
        <option value="user">user</option><option value="admin">admin</option>
      </select>
      <button onclick={mintLink} class="px-3 py-1 rounded border text-xs bg-accent/20 border-accent/30 text-accent">Create link</button>
    </div>
    {#if createdUrl}<div class="text-xs font-mono text-accent break-all mb-3">{createdUrl}</div>{/if}
    <ul class="space-y-1">
      {#each data.links as l (l.id)}
        <li class="flex items-center justify-between text-xs border border-border rounded px-3 py-2">
          <span class="font-mono text-muted">…{l.token.slice(-8)} · {l.role} · uses {l.uses_count}{#if l.max_uses}/{l.max_uses}{/if}</span>
          <button onclick={() => revoke(l.id)} class="text-red-400">Revoke</button>
        </li>
      {/each}
    </ul>
  </section>
</div>
