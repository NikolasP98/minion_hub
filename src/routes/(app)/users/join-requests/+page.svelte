<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  const { data } = $props();
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let linkBusy = $state(false);

  // svelte-ignore state_referenced_locally
  let roleChoices = $state<Record<string, string>>(
    Object.fromEntries(data.requests.map((r) => [r.id, r.requested_role])),
  );

  async function approve(id: string, organizationId: string, role: string) {
    actionError = null;
    busy = id;
    const res = await fetch(`/api/join-requests/${id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId, role }) });
    busy = null;
    if (!res.ok) { actionError = 'Approve failed'; return; }
    await invalidateAll();
  }
  async function deny(id: string) {
    actionError = null;
    busy = id;
    const res = await fetch(`/api/join-requests/${id}/deny`, { method: 'POST' });
    busy = null;
    if (!res.ok) { actionError = 'Deny failed'; return; }
    await invalidateAll();
  }
  // svelte-ignore state_referenced_locally
  let linkOrg = $state(data.orgs[0]?.id ?? '');
  let linkRole = $state('user');
  let createdUrl = $state<string | null>(null);
  async function mintLink() {
    actionError = null;
    linkBusy = true;
    try {
      const res = await fetch('/api/join-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: linkOrg, role: linkRole }) });
      if (!res.ok) { actionError = 'Could not create link'; return; }
      createdUrl = (await res.json()).url;
      await invalidateAll();
    } finally {
      linkBusy = false;
    }
  }
  async function revoke(id: string) {
    actionError = null;
    linkBusy = true;
    try {
      const res = await fetch(`/api/join-links/${id}/revoke`, { method: 'POST' });
      if (!res.ok) { actionError = 'Revoke failed'; return; }
      await invalidateAll();
    } finally {
      linkBusy = false;
    }
  }
</script>

<div class="p-6 space-y-8">
  {#if actionError}
    <div class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2">{actionError}</div>
  {/if}

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
              <select class="bg-bg border border-border rounded px-2 py-1 text-xs" bind:value={roleChoices[r.id]}>
                <option value="user">user</option><option value="admin">admin</option>
              </select>
              <button disabled={busy === r.id} onclick={() => approve(r.id, r.organization_id, roleChoices[r.id])} class="px-3 py-1 rounded border text-xs bg-accent/20 border-accent/30 text-accent">Approve</button>
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
        {#each data.orgs as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
      </select>
      <select class="bg-bg border border-border rounded px-2 py-1 text-xs" bind:value={linkRole}>
        <option value="user">user</option><option value="admin">admin</option>
      </select>
      <button disabled={linkBusy} onclick={mintLink} class="px-3 py-1 rounded border text-xs bg-accent/20 border-accent/30 text-accent">Create link</button>
    </div>
    {#if createdUrl}<div class="text-xs font-mono text-accent break-all mb-3">{createdUrl}</div>{/if}
    <ul class="space-y-1">
      {#each data.links as l (l.id)}
        <li class="flex items-center justify-between text-xs border border-border rounded px-3 py-2">
          <span class="font-mono text-muted">…{l.token.slice(-8)} · {l.role} · uses {l.uses_count}{#if l.max_uses}/{l.max_uses}{/if}</span>
          <button disabled={linkBusy} onclick={() => revoke(l.id)} class="text-red-400">Revoke</button>
        </li>
      {/each}
    </ul>
  </section>
</div>
