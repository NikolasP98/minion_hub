<script lang="ts">
  import { Building2, ChevronDown, Link2, RotateCcw, User } from 'lucide-svelte';
  import {
    Button,
    Card,
    Chip,
    Input,
    PageHeader,
    SegmentedControl,
    Select,
    Spinner,
    StatusDot,
    iconSizes,
  } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  type ProvisionStep = {
    id: string;
    status: 'complete' | 'failed' | 'skipped' | 'warning';
    durationMs: number;
    detail: string;
  };
  type ProvisionResult = {
    ok: boolean;
    organization: { id: string; name: string; slug: string; kind: string } | null;
    steps: ProvisionStep[];
    startedAt: string;
    completedAt: string;
  };
  type OrgRow = {
    id: string;
    name: string;
    slug: string | null;
    kind: string;
    members: number;
    ownerProfileId: string | null;
  };

  const { data } = $props();
  // Seeded once from the load, then appended to optimistically after a provision.
  // svelte-ignore state_referenced_locally
  let organizations = $state<OrgRow[]>(data.organizations);
  let name = $state('');
  let kind = $state('business');
  let ownerProfileId = $state<string | number>('');
  let existingWorkforceCompanyId = $state('');
  let submitting = $state(false);
  let requestError = $state<string | null>(null);

  // Per-org state: last trace (seeded from org_provision_runs so it survives
  // refreshes), expansion, in-flight heal/invite.
  // svelte-ignore state_referenced_locally
  let traces = $state<Record<string, ProvisionResult>>(
    data.savedTraces as Record<string, ProvisionResult>,
  );
  let expandedId = $state<string | null>(null);
  let healingId = $state<string | null>(null);
  let inviteUrls = $state<Record<string, string>>({});
  let invitingId = $state<string | null>(null);
  let inviteError = $state<string | null>(null);
  let copiedId = $state<string | null>(null);

  const kindItems = [
    { value: 'business', label: m.orgProvision_kindBusiness() },
    { value: 'personal', label: m.orgProvision_kindPersonal() },
  ];
  const ownerOptions = $derived([
    { value: '', label: m.orgProvision_ownerSelf() },
    ...data.profiles.map((profile) => ({
      value: profile.id,
      label: profile.display_name ?? profile.email ?? profile.id,
    })),
  ]);

  const stepLabels: Record<string, string> = {
    organization: m.orgProvision_stepOrganization(),
    membership: m.orgProvision_stepMembership(),
    rbac: m.orgProvision_stepRbac(),
    workforce: m.orgProvision_stepWorkforce(),
    gateway: m.orgProvision_stepGateway(),
    workstation: m.orgProvision_stepWorkstation(),
    readiness: m.orgProvision_stepReadiness(),
  };

  function absorbResult(payload: ProvisionResult): void {
    const org = payload.organization;
    if (!org) return;
    traces = { ...traces, [org.id]: payload };
    expandedId = org.id;
    if (!organizations.some((row) => row.id === org.id)) {
      organizations = [...organizations, { ...org, members: 1, ownerProfileId: null }].sort(
        (a, b) => a.name.localeCompare(b.name),
      );
    }
  }

  async function callProvision(body: Record<string, unknown>): Promise<ProvisionResult> {
    const response = await fetch('/api/organizations/provision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as ProvisionResult & { message?: string };
    if (!payload.steps) throw new Error(payload.message ?? m.orgProvision_unknownError());
    return payload;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    submitting = true;
    requestError = null;
    try {
      const payload = await callProvision({
        name: name.trim(),
        kind,
        ownerProfileId: ownerProfileId || undefined,
        existingWorkforceCompanyId: existingWorkforceCompanyId.trim() || undefined,
      });
      absorbResult(payload);
      if (payload.ok) name = '';
    } catch (error) {
      requestError = error instanceof Error ? error.message : m.orgProvision_unknownError();
    } finally {
      submitting = false;
    }
  }

  async function heal(orgId: string): Promise<void> {
    if (healingId) return;
    healingId = orgId;
    try {
      absorbResult(await callProvision({ organizationId: orgId }));
    } catch (error) {
      requestError = error instanceof Error ? error.message : m.orgProvision_unknownError();
    } finally {
      healingId = null;
    }
  }

  async function createInvite(orgId: string): Promise<void> {
    if (invitingId) return;
    invitingId = orgId;
    inviteError = null;
    try {
      const response = await fetch('/api/join-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, role: 'member' }),
      });
      const payload = (await response.json()) as { url?: string; message?: string };
      if (!payload.url) throw new Error(payload.message ?? m.orgProvision_unknownError());
      inviteUrls = { ...inviteUrls, [orgId]: payload.url };
    } catch (error) {
      inviteError = error instanceof Error ? error.message : m.orgProvision_unknownError();
    } finally {
      invitingId = null;
    }
  }

  async function copyInvite(orgId: string): Promise<void> {
    const url = inviteUrls[orgId];
    if (!url) return;
    await navigator.clipboard.writeText(url);
    copiedId = orgId;
    setTimeout(() => (copiedId = null), 2000);
  }

  function toggle(orgId: string): void {
    expandedId = expandedId === orgId ? null : orgId;
  }
</script>

<PageShell archetype="form" scroll="page" labelledBy="organization-provision-title">
  <PageHeader
    titleId="organization-provision-title"
    title={m.orgProvision_title()}
    subtitle={m.orgProvision_subtitle()}
  >
    {#snippet leading()}<Building2 size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>

  <PageBody width="content">
    <div class="stack">
      <Card elevation={2} padding="lg">
        <form class="provision-form" onsubmit={submit}>
          <div>
            <h2 class="t-title">{m.orgProvision_formTitle()}</h2>
            <p class="t-body form-copy">{m.orgProvision_formDescription()}</p>
          </div>
          <div class="form-row">
            <Input
              id="organization-name"
              label={m.orgProvision_nameLabel()}
              placeholder={m.orgProvision_namePlaceholder()}
              bind:value={name}
              required
              maxlength={80}
              autocomplete="organization"
              disabled={submitting}
            />
            <div class="kind-field">
              <span class="t-label">{m.orgProvision_kindLabel()}</span>
              <SegmentedControl
                items={kindItems}
                bind:value={kind}
                size="md"
                aria-label={m.orgProvision_kindLabel()}
              />
            </div>
          </div>
          <Select
            id="organization-owner"
            label={m.orgProvision_ownerLabel()}
            helper={m.orgProvision_ownerHelper()}
            options={ownerOptions}
            bind:value={ownerProfileId}
            disabled={submitting}
          />
          <details class="advanced">
            <summary class="t-label">{m.orgProvision_advanced()}</summary>
            <div class="advanced-body">
              <Input
                id="workforce-company-id"
                label={m.orgProvision_workforceIdLabel()}
                helper={m.orgProvision_workforceIdHelper()}
                placeholder="00000000-0000-0000-0000-000000000000"
                bind:value={existingWorkforceCompanyId}
                disabled={submitting}
              />
            </div>
          </details>
          {#if requestError}<p class="error-message" role="alert">{requestError}</p>{/if}
          <div class="submit-row">
            <Button type="submit" variant="primary" disabled={submitting || !name.trim()}>
              {#if submitting}
                <Spinner size="xs" />
                {m.orgProvision_running()}
              {:else}
                <Building2 size={iconSizes.sm} />
                {m.orgProvision_action()}
              {/if}
            </Button>
          </div>
        </form>
      </Card>

      <Card elevation={1} padding="lg">
        <h2 class="t-title">{m.orgProvision_orgsTitle()}</h2>
        <p class="t-body form-copy">{m.orgProvision_orgsDescription()}</p>
        <ul class="organization-list" aria-label={m.orgProvision_orgsTitle()}>
          {#each organizations as organization (organization.id)}
            {@const trace = traces[organization.id]}
            {@const open = expandedId === organization.id}
            <li class="org-item" class:open>
              <Button
                variant="ghost"
                class="org-row"
                aria-expanded={open}
                onclick={() => toggle(organization.id)}
              >
                {#if organization.kind === 'personal'}
                  <User size={iconSizes.sm} aria-label={m.orgProvision_kindPersonal()} role="img" />
                {:else}
                  <Building2
                    size={iconSizes.sm}
                    aria-label={m.orgProvision_kindBusiness()}
                    role="img"
                  />
                {/if}
                <span class="t-label org-name">{organization.name}</span>
                <span class="t-caption org-meta">
                  {organization.slug} · {organization.members}
                  {m.orgProvision_members()}
                </span>
                {#if trace}
                  <Chip status={trace.ok ? 'success' : 'warning'}>
                    {trace.ok ? m.orgProvision_healthy() : m.orgProvision_needsAttention()}
                  </Chip>
                {/if}
                <ChevronDown size={iconSizes.sm} class="chevron" aria-hidden="true" />
              </Button>
              {#if open}
                <div class="org-detail">
                  {#if trace}
                    <ol class="trace-list" aria-label={m.orgProvision_traceTitle()}>
                      {#each trace.steps as step (step.id)}
                        <li class="trace-step">
                          <StatusDot
                            status={step.status === 'complete'
                              ? 'running'
                              : step.status === 'failed'
                                ? 'aborted'
                                : 'idle'}
                            size="sm"
                          />
                          <span class="trace-copy">
                            <strong class="t-label">{stepLabels[step.id] ?? step.id}</strong>
                            <span class="t-caption">{step.detail}</span>
                          </span>
                          <span class="t-mono trace-time">{step.durationMs} ms</span>
                        </li>
                      {/each}
                    </ol>
                  {:else}
                    <p class="t-caption form-copy">{m.orgProvision_notChecked()}</p>
                  {/if}
                  <div class="org-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={healingId !== null}
                      onclick={() => heal(organization.id)}
                    >
                      {#if healingId === organization.id}
                        <Spinner size="xs" />
                        {m.orgProvision_running()}
                      {:else}
                        <RotateCcw size={iconSizes.sm} />
                        {m.orgProvision_rerun()}
                      {/if}
                    </Button>
                    {#if inviteUrls[organization.id]}
                      <span class="t-mono invite-link">{inviteUrls[organization.id]}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() => copyInvite(organization.id)}
                      >
                        {copiedId === organization.id
                          ? m.orgProvision_inviteCopied()
                          : m.orgProvision_inviteCopy()}
                      </Button>
                    {:else}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={invitingId !== null}
                        onclick={() => createInvite(organization.id)}
                      >
                        {#if invitingId === organization.id}
                          <Spinner size="xs" />
                        {:else}
                          <Link2 size={iconSizes.sm} />
                        {/if}
                        {m.orgProvision_inviteAction()}
                      </Button>
                    {/if}
                  </div>
                  {#if inviteError && (invitingId === null || invitingId === organization.id)}
                    <p class="error-message" role="alert">{inviteError}</p>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </Card>
    </div>
  </PageBody>
</PageShell>

<style>
  .stack {
    display: grid;
    gap: var(--space-section);
  }
  .provision-form {
    display: grid;
    gap: var(--space-field-gap);
  }
  .form-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4);
    align-items: start;
  }
  .kind-field {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
  .form-copy {
    color: var(--color-text-secondary);
  }
  .advanced summary {
    cursor: pointer;
    color: var(--color-text-secondary);
  }
  .advanced-body {
    margin-top: var(--space-3);
  }
  .submit-row {
    display: flex;
    justify-content: flex-end;
  }
  .error-message {
    padding: var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
  }

  .organization-list {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin: var(--space-4) 0 0;
    list-style: none;
  }
  .org-item {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  /* Forwarded class on a shared primitive: anchor on the scoped ancestor.
     The Button's inner slot span is the flex row that lays the line out. */
  .org-item :global(.org-row) {
    width: 100%;
    height: auto;
    padding: var(--space-3);
  }
  .org-item :global(.org-row > span) {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .org-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .org-meta {
    flex: 1;
    min-width: 0;
    text-align: left;
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .org-item :global(.chevron) {
    flex-shrink: 0;
    color: var(--color-text-tertiary);
    transition: transform var(--duration-fast) var(--ease-standard);
  }
  .org-item.open :global(.chevron) {
    transform: rotate(180deg);
  }
  .org-detail {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }
  .trace-list {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .trace-step {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
  }
  .trace-step .t-caption {
    color: var(--color-text-secondary);
  }
  .trace-copy {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .trace-time {
    color: var(--color-text-tertiary);
  }
  .org-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .invite-link {
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
    min-width: 0;
  }
  @media (max-width: 48rem) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }
</style>
