<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import { Button, Input, Card } from '$lib/components/ui';
  import HubWordmark from '$lib/components/layout/HubWordmark.svelte';
  import {
    resolveBranding,
    validateHubName,
    hubNameLength,
    brandingValidationAvailable,
    type Branding,
  } from '$lib/branding';
  import { tryUseActions } from '$lib/services/actions/context';
  import {
    runCheckedMutation,
    runTrackedCommand,
    requireOk,
  } from '$lib/services/actions/mutations';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import * as m from '$lib/paraglide/messages';

  interface Settings {
    organizationName: string;
    hubName: string | null;
    branding: Branding;
    canViewBrandingSettings: boolean;
    canEditBranding: boolean;
  }
  let { settings }: { settings: Settings } = $props();
  const actions = tryUseActions();
  let draft = $state<string | null>(null);
  let busy = $state(false);
  let recovering = $state(false);
  let notice = $state<
    'idle' | 'failed' | 'unknown' | 'committed-refreshing' | 'saved' | 'prior-unknown'
  >('idle');
  let generation = 0;
  let originalActionId: number | undefined;
  let controller: AbortController | undefined;
  let disposed = false;
  const actor = () => {
    const user = page.data.user as { id?: string; supabaseId?: string } | null | undefined;
    return user?.supabaseId ?? user?.id ?? '';
  };
  const org = () => (page.data.activeOrgId ?? settings.branding.orgId) as string | null;
  const scope = $derived(
    `${actor()}:${org()}:${settings.branding.orgId}:${settings.canEditBranding}:${actions?.scopeVersion}`,
  );
  $effect(() => {
    scope;
    generation++;
    controller?.abort();
    draft = untrack(() => settings.hubName);
    busy = false;
    recovering = false;
    notice = 'idle';
    originalActionId = undefined;
  });
  onDestroy(() => {
    disposed = true;
    generation++;
    controller?.abort();
  });

  const validation = $derived(draft === null ? { ok: true } : validateHubName(draft));
  const preview = $derived(
    resolveBranding({
      id: settings.branding.orgId ?? '',
      name: settings.organizationName,
      hub_name: draft,
    }),
  );
  const editable = $derived(
    settings.canEditBranding &&
      settings.branding.readStatus === 'ready' &&
      brandingValidationAvailable(),
  );
  const locked = $derived(
    busy || recovering || notice === 'unknown' || notice === 'committed-refreshing',
  );

  function capture() {
    const ownGeneration = ++generation;
    const orgId = org(),
      profile = actor(),
      runtimeVersion = actions?.scopeVersion;
    const current = () =>
      !disposed &&
      generation === ownGeneration &&
      org() === orgId &&
      actor() === profile &&
      actions?.scopeVersion === runtimeVersion &&
      settings.canEditBranding;
    return { orgId, current };
  }

  function committedResponse(
    value: unknown,
    orgId: string | null,
  ): { branding: Branding; hubName: string | null } {
    if (!value || typeof value !== 'object') throw new Error('Invalid branding response');
    const result = value as { branding?: Branding; hubName?: unknown };
    const b = result.branding;
    const canonicalName = b ? validateHubName(b.name) : { ok: false as const };
    const canonicalOverride =
      typeof result.hubName === 'string' ? validateHubName(result.hubName) : null;
    if (
      !b ||
      b.orgId !== orgId ||
      b.readStatus !== 'ready' ||
      !canonicalName.ok ||
      canonicalName.value !== b.name ||
      b.fullName !== `${b.name} Hub` ||
      !['custom', 'organization', 'default'].includes(b.source) ||
      !(
        result.hubName === null ||
        (typeof result.hubName === 'string' &&
          canonicalOverride?.ok &&
          canonicalOverride.value === result.hubName)
      ) ||
      (b.source === 'custom' && result.hubName !== b.name) ||
      (b.source !== 'custom' && result.hubName !== null) ||
      (b.source === 'default' && b.name !== 'MINION')
    )
      throw new Error('Invalid branding response');
    return { branding: b, hubName: result.hubName as string | null };
  }

  async function refresh(current: () => boolean, orgId: string | null) {
    if (!current()) throw new Error('Retired editor');
    await checkedRefresh(
      () => invalidate('app:branding'),
      () => page,
    );
    if (
      !current() ||
      page.data.branding?.orgId !== orgId ||
      page.data.branding?.readStatus !== 'ready'
    )
      throw new Error('Branding refresh is unavailable');
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!editable || locked || !validation.ok) return;
    const owner = capture();
    const submitted = draft;
    controller = new AbortController();
    const editorSignal = controller.signal;
    busy = true;
    notice = 'idle';
    const outcome = await runTrackedCommand(
      actions,
      'settings.organization-branding.save',
      (context) => {
        if (!owner.current()) return Promise.resolve({ status: 'failed' as const });
        originalActionId = context?.actionId;
        return runCheckedMutation({
          context,
          attemptId: 'settings.organization-branding.save.write',
          refreshAttemptId: 'settings.organization-branding.save.refresh',
          mutate: async (runtimeSignal) => {
            const signal = runtimeSignal
              ? AbortSignal.any([runtimeSignal, editorSignal])
              : editorSignal;
            const response = await fetch('/api/organizations/branding', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ hubName: submitted }),
              signal,
            });
            if (!owner.current()) throw new Error('Retired editor');
            await requireOk(response, m.branding_failed());
            const result = committedResponse(await response.json(), owner.orgId);
            if (!owner.current()) throw new Error('Retired editor');
            return result;
          },
          onCommitted: (result) => {
            if (owner.current()) draft = result.hubName;
          },
          refresh: () => refresh(owner.current, owner.orgId),
        });
      },
    );
    if (!owner.current()) return;
    busy = false;
    notice =
      outcome.status === 'succeeded'
        ? 'saved'
        : outcome.status === 'committed-refreshing'
          ? 'committed-refreshing'
          : outcome.status === 'unknown'
            ? 'unknown'
            : 'failed';
  }

  async function recover() {
    if (busy || recovering || !settings.canEditBranding) return;
    const prior = notice;
    const actionId = originalActionId;
    const owner = capture();
    recovering = true;
    try {
      await refresh(owner.current, owner.orgId);
      if (!owner.current()) return;
      if (prior === 'committed-refreshing') {
        if (actionId !== undefined) actions?.reconcile(actionId, 'succeeded');
        originalActionId = undefined;
        notice = 'saved';
      } else {
        // A matching projection cannot prove which uncertain operation committed.
        notice = prior === 'unknown' ? 'prior-unknown' : 'idle';
      }
    } catch {
      // Retain the recovery lock and draft until a ready same-scope read succeeds.
    } finally {
      if (owner.current()) recovering = false;
    }
  }
</script>

{#if settings.canViewBrandingSettings}
  <Card padding="md">
    <form class="organization-branding" onsubmit={save}>
      <h2 class="t-title">{m.branding_title()}</h2>
      <p class="t-body copy">{m.branding_description()}</p>
      <Input
        id="organization-hub-name"
        label={m.branding_label()}
        helper={m.branding_helper()}
        value={draft ?? ''}
        oninput={(event) => {
          draft = (event.target as HTMLInputElement).value;
        }}
        disabled={!editable || locked}
        error={validation.ok ? undefined : m.branding_invalid()}
      />
      <p class="t-caption copy">
        {m.branding_counter({ count: String(hubNameLength(draft ?? preview.name)) })}
      </p>
      <p class="t-caption copy">{m.branding_preview({ hubFullName: preview.fullName })}</p>
      <div class="preview"><HubWordmark name={preview.name} /></div>
      {#if editable}
        <div class="controls">
          <Button
            variant="secondary"
            disabled={locked}
            onclick={() => {
              draft = null;
            }}>{m.branding_useOrganization()}</Button
          >
          <Button
            variant="secondary"
            disabled={locked}
            onclick={() => {
              draft = 'MINION';
            }}>{m.branding_useMinion()}</Button
          >
          <Button type="submit" loading={busy} disabled={locked || !validation.ok}>
            {notice === 'failed'
              ? m.branding_retry()
              : notice === 'prior-unknown'
                ? m.branding_newSave()
                : m.branding_save()}
          </Button>
        </div>
      {:else}
        <p class="t-caption copy">
          {settings.branding.readStatus === 'ready'
            ? m.branding_readOnly()
            : m.branding_unavailable()}
        </p>
      {/if}
      {#if notice !== 'idle'}
        <p class="t-body feedback" role="status" aria-live="polite">
          {notice === 'saved'
            ? m.branding_saved()
            : notice === 'failed'
              ? m.branding_failed()
              : notice === 'unknown'
                ? m.branding_unknown()
                : notice === 'prior-unknown'
                  ? m.branding_priorUnknown()
                  : m.branding_refreshPending()}
        </p>
      {/if}
      {#if settings.canEditBranding && (notice === 'unknown' || notice === 'committed-refreshing' || settings.branding.readStatus === 'unavailable')}
        <div class="controls">
          <Button
            variant="secondary"
            loading={recovering}
            disabled={busy || recovering}
            onclick={recover}
          >
            {notice === 'committed-refreshing' ? m.branding_refreshRetry() : m.branding_reload()}
          </Button>
        </div>
      {/if}
    </form>
  </Card>
{/if}

<style>
  .organization-branding {
    display: grid;
    gap: var(--space-field-gap);
    min-width: 0;
  }
  .copy {
    color: var(--color-text-secondary);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-control-gap);
  }
  .preview {
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .feedback {
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
</style>
