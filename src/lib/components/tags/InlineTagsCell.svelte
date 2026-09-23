<script lang="ts">
  import { Button, Spinner } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import type { TagScope } from '$lib/tags/scope';
  import { tryUseActions } from '$lib/services/actions/context';
  import type { CommandContext, CommandOutcome } from '$lib/services/actions/definition';
  import TagChip from './TagChip.svelte';
  import TagsField from './TagsField.svelte';

  type EntityKind = 'booking' | 'event_type' | 'product' | 'item';
  let {
    scope,
    kind,
    entityId,
    registry,
    selected,
    readonly = [],
    inherited = [],
    canEdit = true,
    onregistrychange,
    onsaved,
    onrefresh,
  }: {
    scope: TagScope;
    kind: EntityKind;
    entityId: string;
    registry: CalTag[];
    selected: CalTag[];
    readonly?: CalTag[];
    inherited?: CalTag[];
    canEdit?: boolean;
    onregistrychange?: (tags: CalTag[]) => void;
    onsaved?: (tags: CalTag[]) => void;
    onrefresh?: () => Promise<void>;
  } = $props();

  // svelte-ignore state_referenced_locally -- selected seeds the optimistic draft once
  let desiredIds = $state(selected.map((tag) => tag.id));
  let retryIds = $state<string[] | null>(null);
  let pending = $state(false),
    failed = $state(false),
    uncertain = $state(false);
  let sequence = 0;
  const actions = tryUseActions();

  $effect(() => {
    if (!pending && !failed) desiredIds = selected.map((tag) => tag.id);
  });
  $effect(() => {
    const scopeVersion = actions?.scopeVersion;
    if (scopeVersion === undefined) return;
    sequence++;
    pending = false;
    failed = false;
    uncertain = false;
    retryIds = null;
  });

  function manualFrom(tags: CalTag[]) {
    const byId = new Map(registry.map((tag) => [tag.id, tag]));
    return tags.map((tag) => byId.get(tag.id)).filter((tag): tag is CalTag => !!tag);
  }
  const sameIds = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));

  async function readAuthoritative(signal?: AbortSignal): Promise<CalTag[] | null> {
    try {
      const response = await fetch(`/api/tags/${kind}/${encodeURIComponent(entityId)}`, { signal });
      if (!response.ok) return null;
      return manualFrom(((await response.json()) as { tags: CalTag[] }).tags);
    } catch {
      return null;
    }
  }
  async function refresh(context?: CommandContext): Promise<CommandOutcome<void>> {
    if (!onrefresh) return { status: 'succeeded', value: undefined };
    try {
      await (context ? context.attempt('tags.refresh', onrefresh) : onrefresh());
      return { status: 'succeeded', value: undefined };
    } catch (error) {
      return { status: 'committed-refreshing', value: undefined, error };
    }
  }
  async function perform(
    ids: string[],
    request: number,
    context?: CommandContext,
  ): Promise<CommandOutcome<void>> {
    let response: Response;
    try {
      const send = () =>
        fetch(`/api/tags/${kind}/${encodeURIComponent(entityId)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tagIds: ids }),
          signal: context?.signal,
        });
      response = await (context ? context.attempt('tags.assign', send) : send());
    } catch (error) {
      const authoritative = await readAuthoritative(context?.signal);
      if (request !== sequence || (context && !context.isCurrent())) return { status: 'unknown' };
      if (
        authoritative &&
        sameIds(
          authoritative.map((tag) => tag.id),
          ids,
        )
      ) {
        desiredIds = ids;
        onsaved?.(authoritative);
        uncertain = false;
        context?.acknowledge();
        return refresh(context);
      }
      if (authoritative) onsaved?.(authoritative);
      uncertain = authoritative === null;
      return { status: authoritative ? 'failed' : 'unknown', error };
    }
    if (!response.ok) {
      const authoritative = await readAuthoritative(context?.signal);
      if (request !== sequence || (context && !context.isCurrent())) return { status: 'unknown' };
      if (authoritative) {
        const converged = sameIds(
          authoritative.map((tag) => tag.id),
          ids,
        );
        desiredIds = authoritative.map((tag) => tag.id);
        onsaved?.(authoritative);
        uncertain = false;
        return { status: converged ? 'succeeded' : 'failed' };
      }
      uncertain = true;
      return { status: 'unknown' };
    }
    let saved: CalTag[];
    try {
      saved = manualFrom(((await response.json()) as { tags: CalTag[] }).tags);
    } catch (error) {
      uncertain = true;
      return { status: 'unknown', error };
    }
    if (request !== sequence || (context && !context.isCurrent())) return { status: 'unknown' };
    context?.acknowledge();
    desiredIds = saved.map((tag) => tag.id);
    onsaved?.(saved);
    uncertain = false;
    return refresh(context);
  }
  async function persist(ids: string[]) {
    const request = ++sequence;
    retryIds = ids;
    pending = true;
    failed = false;
    uncertain = false;
    try {
      const outcome = await (actions
        ? actions.runCommand('tags.assign', (context) => perform(ids, request, context))
        : perform(ids, request));
      if (request === sequence) {
        failed = !['succeeded', 'committed-refreshing'].includes(outcome.status);
        if (!failed) retryIds = null;
      }
    } catch {
      if (request === sequence) {
        failed = true;
        uncertain = true;
      }
    } finally {
      if (request === sequence) pending = false;
    }
  }
  async function retry() {
    const ids = retryIds ?? desiredIds;
    if (uncertain) {
      const authoritative = await readAuthoritative();
      if (!authoritative) return;
      desiredIds = authoritative.map((tag) => tag.id);
      onsaved?.(authoritative);
      uncertain = false;
      if (
        sameIds(
          authoritative.map((tag) => tag.id),
          ids,
        )
      ) {
        failed = false;
        retryIds = null;
        return;
      }
    }
    await persist(ids);
  }
  function change(ids: string[]) {
    desiredIds = ids;
    void persist(ids);
  }
</script>

<div class="inline-tags" class:has-error={failed}>
  <TagsField
    {scope}
    allTags={registry}
    value={desiredIds}
    disabled={!canEdit}
    selectionDisabled={pending}
    onchange={change}
    {onregistrychange}
  />
  {#each readonly as tag (`readonly:${tag.id}`)}
    <TagChip size="sm" name={tag.name} color={tag.color} dashed title={m.tags_read_only()} />
  {/each}
  {#each inherited as tag (`inherited:${tag.id}`)}
    <TagChip
      size="sm"
      name={tag.name}
      color={tag.color}
      dashed
      origin="ingredient"
      title={m.tags_from_ingredients()}
    />
  {/each}
  {#if pending}<Spinner size="xs" label={m.tags_saving()} />{/if}
  {#if failed}<span class="t-caption error">{m.data_table_save_failed()}</span>
    <Button variant="ghost" size="xs" onclick={retry}>{m.asyncAction_retry()}</Button>{/if}
</div>

<style>
  .inline-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .inline-tags.has-error {
    border-radius: var(--radius-sm);
    outline: 1px solid var(--color-danger-fg);
    outline-offset: var(--space-1);
  }
  .error {
    color: var(--color-danger-fg);
  }
</style>
