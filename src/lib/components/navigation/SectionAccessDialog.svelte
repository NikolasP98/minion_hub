<script lang="ts">
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import { Button, Input, Select } from '@minion-stack/ui';
  import Toggle from '$lib/components/ui/Toggle.svelte';
  import { Dialog, FormField, AsyncBoundary } from '$lib/components/ui/foundations';
  import { localizePath } from '$lib/canonical-path';
  import { AUTHORITY_DIALOG_CLASS } from '$lib/components/layout/floating-assistant-modal';
  import { ApiError, fetchJson } from '$lib/api/fetch-json';
  import { tryUseActions } from '$lib/services/actions/context';
  import {
    prepareAuthorityChange,
    RoleSimulationClientError,
    type AuthorityChangeController,
  } from '$lib/services/role-simulation-client';
  import type { CommandContext, CommandOutcome } from '$lib/services/actions/definition';
  import {
    SECTION_ACCESS_ACTIONS,
    sectionAccessSnapshotSchema,
    sectionAccessReceiptSchema,
    type SectionAccessSnapshot,
    type SectionAccessRole,
    type SectionAccessWrite,
    type SectionActionSet,
    type SectionAccessReceipt,
  } from '$lib/nav/section-access';
  import type { SectionAccessChoice } from '$lib/nav/section-access-context';
  import * as m from '$lib/paraglide/messages';

  let {
    open = $bindable(false),
    target,
    choices = [],
    onclose,
  }: {
    open?: boolean;
    target: string;
    choices?: SectionAccessChoice[];
    onclose?: () => void;
  } = $props();
  const actions = tryUseActions();
  type Draft = {
    mode: SectionAccessWrite['mode'];
    caps: SectionActionSet;
    ifOwner: boolean;
    fieldLevel: number;
    scopeChanged: boolean;
    fieldChanged: boolean;
  };
  const emptyCaps = (): SectionActionSet => ({
    view: false,
    create: false,
    edit: false,
    delete: false,
    export: false,
    manage: false,
  });
  const actionLabel = (action: (typeof SECTION_ACCESS_ACTIONS)[number]): string =>
    ({
      view: m.sectionAccess_view,
      create: m.sectionAccess_create,
      edit: m.sectionAccess_edit,
      delete: m.sectionAccess_delete,
      export: m.sectionAccess_export,
      manage: m.sectionAccess_manage,
    })[action]();
  const owner = () =>
    JSON.stringify([
      page.data.user?.id,
      page.data.activeOrgId,
      (page.data as { roleSimulation?: { generation: string } }).roleSimulation?.generation,
    ]);
  const ownerKey = $derived(owner());
  let snapshot = $state.raw<SectionAccessSnapshot | null>(null);
  let activeTarget = $state('');
  let roleKey = $state('');
  let drafts = $state<Record<string, Draft>>({});
  let loading = $state(false);
  let saving = $state(false);
  let readError = $state(false);
  let saveError = $state('');
  let conflict = $state(false);
  let review = $state(false);
  let committed = $state(false);
  let navigationOnly = $state(false);
  let authorityChange = $state.raw<AuthorityChangeController | null>(null);
  let request = 0;
  onDestroy(() => {
    request++;
  });
  const selected = $derived(snapshot?.roles.find((role) => role.key === roleKey));
  const draft = $derived(drafts[roleKey]);
  const visibilityOnly = $derived(snapshot?.kind === 'section' || snapshot?.kind === 'page');
  const availableActions = $derived(visibilityOnly ? (['view'] as const) : SECTION_ACCESS_ACTIONS);
  const dirty = $derived(
    Boolean(
      selected &&
      draft &&
      JSON.stringify(writeFor(selected, draft)) !==
        JSON.stringify(writeFor(selected, draftFor(selected))),
    ),
  );
  const canReview = $derived(
    Boolean(
      dirty &&
      selected &&
      !selected.protected &&
      !loading &&
      !saving &&
      !conflict &&
      !navigationOnly,
    ),
  );
  const summary = (caps: SectionActionSet): string =>
    SECTION_ACCESS_ACTIONS.filter((a) => caps[a])
      .map(actionLabel)
      .join(', ') || m.sectionAccess_none();
  const afterCaps = $derived(
    draft?.mode === 'inherit'
      ? selected?.defaults
      : draft?.mode === 'deny'
        ? emptyCaps()
        : draft?.caps,
  );

  const afterIfOwner = $derived(
    draft?.mode === 'inherit'
      ? selected?.inheritedIfOwner
      : Boolean(draft?.ifOwner || selected?.inheritedIfOwner),
  );
  const afterFieldLevel = $derived(
    draft?.mode === 'inherit' ? selected?.inheritedFieldLevel : draft?.fieldLevel,
  );
  const recordScopeLabel = (restricted: boolean) =>
    restricted ? m.sectionAccess_owned() : m.sectionAccess_allRecords();
  function draftFor(role: SectionAccessRole): Draft {
    return {
      mode: role.explicit
        ? SECTION_ACCESS_ACTIONS.every((a) => !role.explicit!.caps[a])
          ? 'deny'
          : 'override'
        : 'inherit',
      caps: { ...(role.explicit?.caps ?? role.effective) },
      ifOwner: role.effectiveIfOwner,
      fieldLevel: role.effectiveFieldLevel,
      scopeChanged: false,
      fieldChanged: false,
    };
  }
  function writeFor(role: SectionAccessRole, value: Draft): SectionAccessWrite {
    return {
      target: activeTarget,
      roleKey: role.key,
      revision: role.revision,
      mode: value.mode,
      ...(value.mode === 'override' ? { caps: { ...value.caps } } : {}),
      ...(value.mode !== 'inherit' && value.scopeChanged ? { ifOwner: value.ifOwner } : {}),
      ...(value.mode !== 'inherit' && value.fieldChanged ? { fieldLevel: value.fieldLevel } : {}),
    };
  }
  function current(epoch: number, capturedOwner: string, capturedTarget: string) {
    return (
      open && request === epoch && owner() === capturedOwner && activeTarget === capturedTarget
    );
  }
  async function load(preserveDraft = false) {
    const epoch = ++request,
      capturedOwner = owner(),
      capturedTarget = activeTarget;
    loading = true;
    readError = false;
    try {
      const raw = await fetchJson<unknown>(
        `/api/nav/access?target=${encodeURIComponent(capturedTarget)}`,
      );
      const fresh = sectionAccessSnapshotSchema.parse(raw);
      if (!current(epoch, capturedOwner, capturedTarget)) return;
      if (fresh.target !== capturedTarget) throw new Error('Policy target changed');
      snapshot = fresh;
      if (!fresh.roles.some((role) => role.key === roleKey))
        roleKey = fresh.roles.find((role) => !role.protected)?.key ?? fresh.roles[0]?.key ?? '';
      drafts = Object.fromEntries(
        fresh.roles.map((role) => [
          role.key,
          preserveDraft && drafts[role.key] ? drafts[role.key] : draftFor(role),
        ]),
      );
      conflict = false;
      saveError = '';
      review = false;
    } catch {
      if (current(epoch, capturedOwner, capturedTarget)) readError = true;
    } finally {
      if (current(epoch, capturedOwner, capturedTarget)) loading = false;
    }
  }
  $effect(() => {
    const isOpen = open,
      requestedTarget = target;
    const capturedOwner = ownerKey;
    untrack(() => {
      if (capturedOwner !== owner()) return;
      request++;
      if (!isOpen) {
        activeTarget = '';
        return;
      }
      activeTarget = requestedTarget;
      saving = false;
      snapshot = null;
      drafts = {};
      roleKey = '';
      committed = false;
      navigationOnly = false;
      authorityChange = null;
      review = false;
      conflict = false;
      saveError = '';
      void load();
    });
    return () => {
      request++;
    };
  });
  function chooseTarget(next: string) {
    if (saving || next === activeTarget) return;
    activeTarget = next;
    snapshot = null;
    drafts = {};
    roleKey = '';
    committed = false;
    navigationOnly = false;
    authorityChange = null;
    review = false;
    conflict = false;
    saveError = '';
    void load();
  }
  function toggleAction(action: (typeof SECTION_ACCESS_ACTIONS)[number], checked: boolean) {
    if (!draft || saving || review) return;
    const caps = { ...draft.caps, [action]: checked };
    if (action === 'view' && !checked) Object.assign(caps, emptyCaps());
    if (action !== 'view' && checked) caps.view = true;
    draft.caps = caps;
  }
  function navigationFailure() {
    saveError = committed ? m.sectionAccess_savedRefresh() : m.sectionAccess_unknown();
  }
  /** Recovery repeats only the captured document GET; it never repeats the policy write. */
  function refresh() {
    if (!navigationOnly || !authorityChange) return;
    saving = true;
    try {
      authorityChange.retryNavigation();
    } catch {
      navigationFailure();
    } finally {
      saving = false;
    }
  }
  function destination(saved: SectionAccessReceipt): string {
    const path = saved.location ?? page.url.pathname + page.url.search + page.url.hash;
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Invalid access destination');
    const url = new URL(path, page.url.origin);
    if (url.origin !== page.url.origin) throw new Error('Invalid access destination');
    return localizePath(url.pathname) + url.search + url.hash;
  }
  function retireUnknown(change: AuthorityChangeController) {
    navigationOnly = true;
    review = false;
    saveError = m.sectionAccess_unknown();
    try {
      change.unknown(localizePath('/account/home'));
    } catch {
      navigationFailure();
    }
  }
  async function perform(
    body: SectionAccessWrite,
    change: AuthorityChangeController,
    context?: CommandContext,
  ): Promise<CommandOutcome<void>> {
    const capturedOwner = owner(),
      capturedTarget = activeTarget,
      epoch = request;
    let saved: SectionAccessReceipt;
    let location: string;
    try {
      const response = await change.fetch('/api/nav/access', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: context?.signal,
      });
      if (!response.ok) {
        // Only an explicit validation/permission/conflict rejection proves no commit.
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 401 &&
          response.status !== 408
        )
          throw new ApiError(
            'Access change rejected',
            response.status === 409 ? 'conflict' : 'validation',
            response.status,
          );
        throw new ApiError('Access result unavailable', 'network', 0);
      }
      saved = sectionAccessReceiptSchema.parse(await response.json());
      location = destination(saved);
    } catch (error) {
      if (!current(epoch, capturedOwner, capturedTarget) || !change.isCurrent())
        return { status: 'unknown' };
      const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (rejected) {
        change.cancel();
        authorityChange = null;
        conflict = error.status === 409;
        saveError = conflict ? m.sectionAccess_conflict() : m.sectionAccess_saveFailed();
        return { status: conflict ? 'conflict' : 'failed', error };
      }
      retireUnknown(change);
      return { status: 'unknown', error };
    }
    context?.acknowledge();
    if (!current(epoch, capturedOwner, capturedTarget) || !change.isCurrent())
      return { status: 'succeeded', value: undefined };
    committed = true;
    navigationOnly = true;
    review = false;
    // Retire the old shell, overlays and read publications before any fallible continuation.
    // No invalidation may leave a tightened record/field policy behind a Cancel button.
    try {
      change.commit(location);
    } catch {
      navigationFailure();
      return { status: 'committed-refreshing' };
    }
    return { status: 'succeeded', value: undefined };
  }
  async function apply() {
    if (!review || !canReview || !selected || !draft) return;
    const body = writeFor(selected, draft);
    const capturedOwner = owner(),
      capturedTarget = activeTarget,
      epoch = request;
    saving = true;
    saveError = '';
    let change: AuthorityChangeController | undefined;
    let dispatched = false;
    let commandId: number | undefined;
    try {
      // Drain external work before our command exists, so it cannot wait for itself.
      change = await prepareAuthorityChange(actions);
      if (!current(epoch, capturedOwner, capturedTarget) || !change.isCurrent()) {
        change.cancel();
        return;
      }
      authorityChange = change;
      const performOnce = (context?: CommandContext) => {
        commandId = context?.actionId;
        dispatched = true;
        return perform(body, change!, context);
      };
      const outcome = await (actions
        ? actions.runCommand('navigation.access', performOnce)
        : performOnce());
      if (
        current(epoch, capturedOwner, capturedTarget) &&
        authorityChange === null &&
        commandId !== undefined &&
        (outcome.status === 'failed' || outcome.status === 'conflict')
      ) {
        // This editor owns the known rejection and its retained draft; do not
        // let its settled activity block the next explicitly reviewed attempt.
        actions?.dismiss(commandId);
      }
      if (
        current(epoch, capturedOwner, capturedTarget) &&
        !navigationOnly &&
        authorityChange === change
      ) {
        if (!dispatched) {
          change.cancel();
          authorityChange = null;
          saveError = m.sectionAccess_cannotPrepare();
        } else if (outcome.status === 'failed' || outcome.status === 'unknown') {
          // Runtime retirement can settle before an admitted request returns.
          // Keep that outcome unknown and conceal the old authority instead of replaying.
          retireUnknown(change);
        }
      }
    } catch (error) {
      if (!current(epoch, capturedOwner, capturedTarget)) return;
      if (change && dispatched) retireUnknown(change);
      else {
        change?.cancel();
        saveError =
          error instanceof RoleSimulationClientError && error.code === 'dirty'
            ? m.sectionAccess_dirtyBeforeApply()
            : error instanceof RoleSimulationClientError &&
                ['pending', 'attention', 'busy'].includes(error.code)
              ? m.sectionAccess_pendingBeforeApply()
              : m.sectionAccess_cannotPrepare();
      }
    } finally {
      if (current(epoch, capturedOwner, capturedTarget)) saving = false;
    }
  }
  function close() {
    if (saving || navigationOnly) return;
    open = false;
    onclose?.();
  }
</script>

<Dialog
  class={AUTHORITY_DIALOG_CLASS}
  bind:open
  title={review
    ? m.sectionAccess_reviewTitle()
    : snapshot?.kind === 'page'
      ? m.sectionAccess_pageTitle()
      : m.sectionAccess_title()}
  presentation="sheet"
  placement="right"
  size="md"
  dismissible={!saving && !navigationOnly}
  dirty={dirty && !navigationOnly}
  onclose={() => onclose?.()}
>
  <div class="access-editor">
    {#if choices.length > 1}
      <Select
        label={m.sectionAccess_scope()}
        value={activeTarget}
        disabled={saving || review || navigationOnly}
        options={choices.map((choice) => ({ value: choice.target, label: choice.label }))}
        onchange={(event) => chooseTarget((event.currentTarget as HTMLSelectElement).value)}
      />
      <p class="t-caption">{m.sectionAccess_multi()}</p>
    {/if}
    <AsyncBoundary
      state={readError
        ? {
            kind: 'error',
            description: m.sectionAccess_readFailed(),
            retry: () => void load(Boolean(snapshot)),
          }
        : !snapshot
          ? { kind: 'loading' }
          : snapshot.roles.length === 0
            ? { kind: 'empty', title: m.sectionAccess_noRoles() }
            : { kind: 'ready' }}
    >
      {#if snapshot && selected && draft}
        <p class="t-label scope-label">{snapshot.orgName} · {snapshot.label}</p>
        <p class="t-caption">
          {visibilityOnly ? m.sectionAccess_visibility() : m.sectionAccess_module()}
        </p>
        {#if review}
          <p class="t-body">
            {m.sectionAccess_reviewSummary({
              organization: snapshot.orgName,
              role: selected.name,
              target: snapshot.label,
            })}
          </p>
          <dl class="review-list t-body">
            <dt>{m.sectionAccess_before()}</dt>
            <dd>{summary(selected.effective)}</dd>
            <dt>{m.sectionAccess_after()}</dt>
            <dd>
              {afterCaps ? summary(afterCaps) : m.sectionAccess_none()} · {draft.mode === 'inherit'
                ? m.sectionAccess_inherit()
                : draft.mode === 'deny'
                  ? m.sectionAccess_deny()
                  : m.sectionAccess_override()}
            </dd>
            {#if snapshot.ownerScopable && afterIfOwner !== undefined && selected.effectiveIfOwner !== afterIfOwner && afterCaps?.view}
              <dt>{m.sectionAccess_recordScope()}</dt>
              <dd>
                {recordScopeLabel(selected.effectiveIfOwner)} → {recordScopeLabel(afterIfOwner)}
              </dd>
            {/if}
            {#if snapshot.fieldScopable && afterFieldLevel !== undefined && selected.effectiveFieldLevel !== afterFieldLevel}
              <dt>{m.sectionAccess_fieldLevel()}</dt>
              <dd>{selected.effectiveFieldLevel} → {afterFieldLevel}</dd>
            {/if}
          </dl>
        {:else}
          <Select
            label={m.sectionAccess_role()}
            value={roleKey}
            disabled={saving || navigationOnly}
            options={snapshot.roles.map((role) => ({ value: role.key, label: role.name }))}
            onchange={(event) => {
              roleKey = (event.currentTarget as HTMLSelectElement).value;
              saveError = '';
              conflict = false;
            }}
          />
          <div class="policy-current t-caption">
            <p><strong>{m.sectionAccess_effective()}:</strong> {summary(selected.effective)}</p>
            <p>
              <strong
                >{selected.explicit
                  ? m.sectionAccess_explicit()
                  : m.sectionAccess_defaults()}:</strong
              >
              {summary(selected.explicit?.caps ?? selected.defaults)}
            </p>
          </div>
          {#if selected.protected}<p class="t-body protected" role="status">
              {m.sectionAccess_ownerProtected()}
            </p>{/if}
          <Select
            label={m.sectionAccess_policy()}
            value={draft.mode}
            disabled={selected.protected || saving || navigationOnly}
            options={[
              { value: 'inherit', label: m.sectionAccess_inherit() },
              { value: 'override', label: m.sectionAccess_override() },
              { value: 'deny', label: m.sectionAccess_deny() },
            ]}
            onchange={(event) => {
              draft.mode = (event.currentTarget as HTMLSelectElement).value as Draft['mode'];
            }}
          />
          {#if draft.mode === 'override'}
            <div class="actions-list">
              {#each availableActions as action}
                <Toggle
                  label={actionLabel(action)}
                  checked={draft.caps[action]}
                  disabled={selected.protected || saving || navigationOnly}
                  onchange={(checked) => toggleAction(action, checked)}
                />
              {/each}
            </div>
            {#if snapshot.ownerScopable}
              <Toggle
                label={m.sectionAccess_owned()}
                checked={draft.ifOwner}
                disabled={selected.protected || saving || navigationOnly}
                onchange={(checked) => {
                  draft.ifOwner = checked;
                  draft.scopeChanged = true;
                }}
              />
            {/if}
            {#if snapshot.fieldScopable}
              <FormField
                label={m.sectionAccess_fieldLevel()}
                helper={m.sectionAccess_fieldHint()}
                disabled={selected.protected || saving || navigationOnly}
              >
                {#snippet children(control)}<Input
                    {...control}
                    type="number"
                    min={0}
                    max={9}
                    value={String(draft.fieldLevel)}
                    oninput={(event) => {
                      draft.fieldLevel = Number((event.currentTarget as HTMLInputElement).value);
                      draft.fieldChanged = true;
                    }}
                  />{/snippet}
              </FormField>
            {/if}
          {/if}
        {/if}
      {/if}
    </AsyncBoundary>
    {#if saveError}<p class="save-error t-body" role="alert">{saveError}</p>{/if}
    {#if conflict && !navigationOnly}<Button
        variant="outline"
        onclick={() => void load(true)}
        {loading}>{m.sectionAccess_reviewLatest()}</Button
      >{/if}
    {#if committed}<p class="t-body" role="status">{m.sectionAccess_saved()}</p>{/if}
  </div>
  {#snippet footer()}
    {#if !navigationOnly}<Button variant="ghost" onclick={close} disabled={saving}
        >{m.common_cancel()}</Button
      >{/if}
    {#if navigationOnly}<Button variant="primary" onclick={() => void refresh()} loading={saving}
        >{m.sectionAccess_refresh()}</Button
      >
    {:else if review}
      <Button variant="outline" onclick={() => (review = false)} disabled={saving}
        >{m.common_edit()}</Button
      >
      <Button variant="primary" onclick={() => void apply()} loading={saving} disabled={!canReview}
        >{m.sectionAccess_apply()}</Button
      >
    {:else}<Button variant="primary" onclick={() => (review = true)} disabled={!canReview}
        >{m.sectionAccess_review()}</Button
      >{/if}
  {/snippet}
</Dialog>

<style>
  .access-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }
  .access-editor p,
  .access-editor dd,
  .scope-label {
    overflow-wrap: anywhere;
  }
  .access-editor .t-caption {
    color: var(--color-text-secondary);
  }
  .policy-current {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-2);
    border-radius: var(--radius-md);
  }
  .actions-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .review-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
  }
  .review-list dt {
    color: var(--color-text-secondary);
  }
  .review-list dd {
    margin: 0;
  }
  .protected {
    color: var(--color-info-fg);
  }
  .save-error {
    color: var(--color-danger-fg);
  }
  .access-editor :global(button),
  .access-editor :global(select),
  .access-editor :global(input) {
    min-height: var(--control-height-touch);
  }
</style>
