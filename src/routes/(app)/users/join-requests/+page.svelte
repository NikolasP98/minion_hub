<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { Badge, Button, PageHeader, Select } from '$lib/components/ui';
  import { AsyncBoundary, FormFieldset, PageBody, PageShell } from '$lib/components/ui/foundations';
  import { Link2, UserRoundCheck } from 'lucide-svelte';

  const { data } = $props();
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let linkBusy = $state(false);

  // svelte-ignore state_referenced_locally -- editable choices are seeded from server data once.
  let roleChoices = $state<Record<string, string>>(
    Object.fromEntries(data.requests.map((request) => [request.id, request.requested_role])),
  );

  async function approve(id: string, organizationId: string, role: string) {
    actionError = null;
    busy = id;
    try {
      const response = await fetch(`/api/join-requests/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, role }),
      });
      if (!response.ok) {
        actionError = 'Approve failed';
        return;
      }
      await invalidateAll();
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Approve failed';
    } finally {
      busy = null;
    }
  }

  async function deny(id: string) {
    actionError = null;
    busy = id;
    try {
      const response = await fetch(`/api/join-requests/${id}/deny`, { method: 'POST' });
      if (!response.ok) {
        actionError = 'Deny failed';
        return;
      }
      await invalidateAll();
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Deny failed';
    } finally {
      busy = null;
    }
  }

  // svelte-ignore state_referenced_locally -- editable choice is seeded from the first server org.
  let linkOrg = $state(data.orgs[0]?.id ?? '');
  let linkRole = $state('user');
  let createdUrl = $state<string | null>(null);

  async function mintLink() {
    if (!linkOrg) return;
    actionError = null;
    linkBusy = true;
    try {
      const response = await fetch('/api/join-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: linkOrg, role: linkRole }),
      });
      if (!response.ok) {
        actionError = 'Could not create link';
        return;
      }
      createdUrl = (await response.json()).url;
      await invalidateAll();
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Could not create link';
    } finally {
      linkBusy = false;
    }
  }

  async function revoke(id: string) {
    actionError = null;
    linkBusy = true;
    try {
      const response = await fetch(`/api/join-links/${id}/revoke`, { method: 'POST' });
      if (!response.ok) {
        actionError = 'Revoke failed';
        return;
      }
      await invalidateAll();
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Revoke failed';
    } finally {
      linkBusy = false;
    }
  }
</script>

<PageShell archetype="collection" scroll="page" labelledBy="join-requests-title">
  <PageHeader
    titleId="join-requests-title"
    title="Join requests"
    subtitle="Review membership requests and manage reusable invitation links"
  >
    {#snippet leading()}<UserRoundCheck size={16} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>

  <PageBody width="content">
    <div class="join-request-body">
      {#if actionError}
        <div class="action-error" role="alert">{actionError}</div>
      {/if}

      <section aria-labelledby="pending-requests-heading">
        <div class="section-heading">
          <div>
            <h2 id="pending-requests-heading">Pending requests</h2>
            <p>Choose a role before admitting each requester.</p>
          </div>
          <Badge>{data.requests.length}</Badge>
        </div>

        <AsyncBoundary
          state={data.requests.length === 0
            ? {
                kind: 'empty',
                title: 'No pending requests',
                description: 'New membership requests will appear here for review.',
              }
            : { kind: 'ready' }}
          compact
        >
          <ul class="request-list" aria-label="Pending join requests">
            {#each data.requests as request (request.id)}
              <li class="request-row">
                <div class="request-copy">
                  <strong>{request.display_name ?? request.email}</strong>
                  <span>{request.email}</span>
                  {#if request.message}<p>“{request.message}”</p>{/if}
                </div>
                <div class="request-actions">
                  <Select
                    size="sm"
                    label="Role"
                    bind:value={roleChoices[request.id]}
                    disabled={busy === request.id}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </Select>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy === request.id}
                    onclick={() =>
                      approve(
                        request.id,
                        request.organization_id,
                        roleChoices[request.id] ?? request.requested_role,
                      )}>Approve</Button
                  >
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy === request.id}
                    onclick={() => deny(request.id)}>Deny</Button
                  >
                </div>
              </li>
            {/each}
          </ul>
        </AsyncBoundary>
      </section>

      <section aria-labelledby="join-links-heading">
        <div class="section-heading">
          <div>
            <h2 id="join-links-heading">Join links</h2>
            <p>Create a shareable link for a specific organization and role.</p>
          </div>
          <Link2 size={18} class="shrink-0 text-muted" aria-hidden="true" />
        </div>

        <form
          class="link-form"
          onsubmit={(event) => {
            event.preventDefault();
            void mintLink();
          }}
        >
          <FormFieldset
            legend="Create a reusable join link"
            helper="Anyone with the URL can request the selected role."
            disabled={linkBusy || data.orgs.length === 0}
          >
            <div class="link-controls">
              <Select size="sm" label="Organization" bind:value={linkOrg}>
                {#each data.orgs as organization (organization.id)}
                  <option value={organization.id}>{organization.name}</option>
                {/each}
              </Select>
              <Select size="sm" label="Role" bind:value={linkRole}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </Select>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={linkBusy}
                disabled={!linkOrg}>Create link</Button
              >
            </div>
          </FormFieldset>
        </form>

        {#if createdUrl}
          <output class="created-link" aria-live="polite">{createdUrl}</output>
        {/if}

        <AsyncBoundary
          state={data.links.length === 0
            ? {
                kind: 'empty',
                title: 'No active join links',
                description: 'Create a link above when you are ready to invite someone.',
              }
            : { kind: 'ready' }}
          compact
        >
          <ul class="link-list" aria-label="Active join links">
            {#each data.links as link (link.id)}
              <li class="link-row">
                <span class="link-meta">
                  …{link.token.slice(-8)} · {link.role} · uses {link.uses_count}{#if link.max_uses}/{link.max_uses}{/if}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={linkBusy}
                  onclick={() => revoke(link.id)}>Revoke</Button
                >
              </li>
            {/each}
          </ul>
        </AsyncBoundary>
      </section>
    </div>
  </PageBody>
</PageShell>

<style>
  .join-request-body {
    display: grid;
    align-content: start;
    gap: var(--space-page-section, 32px);
  }
  .action-error {
    padding: var(--space-3, 12px);
    border: 1px solid var(--color-danger-border, var(--color-destructive));
    border-radius: var(--radius-md);
    color: var(--color-danger-fg, var(--color-destructive));
    background: var(--color-danger-surface, transparent);
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  .section-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3, 12px);
    margin-bottom: var(--space-3, 12px);
  }
  .section-heading h2 {
    color: var(--color-text-primary, var(--color-foreground));
    font-size: var(--font-size-section-title, 14px);
    line-height: var(--line-height-heading, 20px);
    font-weight: var(--font-weight-semibold, 600);
  }
  .section-heading p {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  .request-list,
  .link-list {
    display: grid;
    gap: var(--space-2, 8px);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .request-row,
  .link-row {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4, 16px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border: 1px solid var(--color-border-subtle, var(--hairline));
    border-radius: var(--radius-lg);
    background: var(--color-surface-2, var(--elevation-2-bg));
  }
  .request-copy {
    display: grid;
    min-width: 0;
    gap: var(--space-0-5, 2px);
  }
  .request-copy strong {
    overflow: hidden;
    color: var(--color-text-primary, var(--color-foreground));
    font-size: var(--font-size-body, 14px);
    line-height: var(--line-height-body, 20px);
    text-overflow: ellipsis;
  }
  .request-copy span,
  .request-copy p,
  .link-meta {
    overflow-wrap: anywhere;
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  .request-copy p {
    margin-top: var(--space-1, 4px);
  }
  .request-actions,
  .link-controls {
    display: flex;
    flex: none;
    align-items: end;
    gap: var(--space-2, 8px);
  }
  .link-form {
    padding: var(--space-4, 16px);
    border: 1px solid var(--color-border-subtle, var(--hairline));
    border-radius: var(--radius-lg);
    background: var(--color-surface-2, var(--elevation-2-bg));
  }
  .created-link {
    display: block;
    margin-top: var(--space-3, 12px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    overflow-wrap: anywhere;
    border-radius: var(--radius-md);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  .link-list {
    margin-top: var(--space-3, 12px);
  }
  .link-meta {
    min-width: 0;
    font-family: var(--font-mono);
  }

  @media (max-width: 767.98px) {
    .request-row,
    .link-row {
      align-items: stretch;
      flex-direction: column;
    }
    .request-actions,
    .link-controls {
      display: grid;
      width: 100%;
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
    .link-controls {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
