<script lang="ts">
  import { getBranding } from '$lib/branding.svelte';
  import { page } from '$app/state';
  import { ShieldCheck, TriangleAlert } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { fmtTimeAgo } from '$lib/utils/format';
  import { iconSizes, Button, Select } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The approval request lives in the URL; the forms post to it so the server re-validates it.
  const query = $derived(
    (() => {
      const q = new URLSearchParams(page.url.search);
      q.delete('refused');
      return q.toString();
    })(),
  );
  const refusal = $derived(
    data.refused === 'org'
      ? m.oauth_authorize_org_invalid()
      : data.refused === 'origin'
        ? m.oauth_authorize_refused_origin()
        : data.refused === 'invalid'
          ? m.oauth_authorize_failed()
          : null,
  );
  let picked = $state('');
  const orgs = $derived(data.valid ? data.orgs : []);
  const orgId = $derived(orgs.length === 1 ? orgs[0]!.id : picked);
</script>

<svelte:head><title>{m.oauth_authorize_eyebrow()} — {getBranding().fullName}</title></svelte:head>

{#snippet taskIcon()}
  {#if data.valid && orgs.length > 0}
    <ShieldCheck size={iconSizes.lg} />
  {:else}
    <TriangleAlert size={iconSizes.lg} />
  {/if}
{/snippet}

<PublicTaskShell
  eyebrow={m.oauth_authorize_eyebrow()}
  title={data.valid
    ? orgs.length > 0
      ? m.oauth_authorize_title({ app: data.appName, hubFullName: getBranding().fullName })
      : m.oauth_authorize_no_org_title()
    : m.oauth_authorize_invalid_title()}
  description={data.valid
    ? orgs.length > 0
      ? m.oauth_authorize_description()
      : m.oauth_authorize_no_org_description()
    : m.oauth_authorize_invalid_description()}
  tone={data.valid && orgs.length > 0 ? 'default' : 'warning'}
  icon={taskIcon}
  size="medium"
>
  {#if data.valid && orgs.length > 0}
    <dl class="facts">
      <dt class="t-caption">{m.oauth_authorize_app()}</dt>
      <dd class="t-body">
        {data.appName}
        <span class="t-caption muted">
          — {m.oauth_authorize_unverified()} · {m.oauth_authorize_registered({
            when: fmtTimeAgo(data.registeredAt),
          })}
        </span>
      </dd>
      <dt class="t-caption">{m.oauth_authorize_return_address()}</dt>
      <dd class="t-mono address">{data.redirectUri}</dd>
    </dl>
    <form method="POST" action={`?/approve&${query}`} class="form">
      {#if orgs.length === 1}
        <input type="hidden" name="org_id" value={orgId} />
        <p class="t-body">{m.oauth_authorize_org_label()}: {orgs[0]!.name}</p>
      {:else}
        <Select
          id="oauth-org"
          name="org_id"
          label={m.oauth_authorize_org_label()}
          bind:value={picked}
          required
          options={[
            { value: '', label: m.oauth_authorize_org_placeholder() },
            ...orgs.map((o) => ({ value: o.id, label: o.name })),
          ]}
        />
      {/if}
      {#if refusal}
        <p class="error">{refusal}</p>
      {/if}
      <Button type="submit" variant="primary" size="touch" class="w-full" disabled={!orgId}>
        {m.oauth_authorize_approve()}
      </Button>
    </form>
    <form method="POST" action={`?/deny&${query}`} class="form">
      <Button type="submit" variant="ghost" size="touch" class="w-full">
        {m.oauth_authorize_deny()}
      </Button>
    </form>
  {:else}
    <p class="t-body">{m.oauth_authorize_invalid_hint()}</p>
    {#if refusal}<p class="error">{refusal}</p>{/if}
  {/if}
</PublicTaskShell>

<style>
  .facts {
    display: grid;
    gap: var(--space-1);
    margin: 0 0 var(--space-4);
  }
  .facts dd {
    margin: 0 0 var(--space-2);
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .address {
    overflow-wrap: anywhere;
    color: var(--color-text-secondary);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
  }
</style>
