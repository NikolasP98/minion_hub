<script lang="ts">
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { ArrowUp, ArrowDown, LayoutGrid } from 'lucide-svelte';
  import { Button, EmptyState, PageHeader, iconSizes } from '$lib/components/ui';
  import { PageShell, PageBody } from '$lib/components/ui/foundations';
  import NavIcon from '$lib/components/layout/NavIcon.svelte';
  import { createAutosave } from '$lib/records/autosave.svelte';
  import { saveAndRefresh, createSaveStatus } from '$lib/records/save-status.svelte';
  import SaveIndicator from '$lib/records/SaveIndicator.svelte';
  import { fetchJson } from '$lib/api/fetch-json';
  import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
  import {
    personalCatalog,
    personalDraft,
    committedPersonalNavigation,
    personalPreferenceKey,
  } from '$lib/nav/personal-navigation.svelte';
  import { orderPersonalSections, type PersonalNavigation } from '$lib/nav/personal-navigation';
  import * as m from '$lib/paraglide/messages';

  const token = Symbol('personal-navigation-editor');
  const saveStatus = createSaveStatus();
  let editRevision = 0;
  async function reviewLatest() {
    const owner = preferenceOwner();
    const revision = ++editRevision;
    await invalidate('app:preferences');
    if (owner !== preferenceOwner() || personalDraft.token !== token || revision !== editRevision)
      return;
    layout.cancel();
    saveStatus.reset();
  }
  const layout = createAutosave<PersonalNavigation>({
    committed: committedPersonalNavigation,
    status: saveStatus,
    scope: () => preferenceOwner() ?? undefined,
    debounceMs: 0,
    prepare: (value, isCurrent) => {
      const key = personalPreferenceKey();
      return () =>
        saveAndRefresh(
          () =>
            fetchJson(`/api/me/preferences/${encodeURIComponent(key)}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ value }),
            }),
          () => invalidate('app:preferences'),
          isCurrent,
        ).then(() => undefined);
    },
  });
  $effect(() => {
    personalDraft.owner = preferenceOwner();
    personalDraft.token = token;
    personalDraft.value = layout.value;
  });
  onDestroy(() => {
    if (personalDraft.token === token) {
      personalDraft.owner = null;
      personalDraft.value = null;
      personalDraft.token = null;
    }
  });
  const sections = $derived(orderPersonalSections(personalCatalog(), layout.value));
  const selectedId = $derived(page.url.searchParams.get('section'));
  const selected = $derived(selectedId ? sections.find((s) => s.id === selectedId) : undefined);
  function toggle(id: string) {
    editRevision++;
    const value = layout.value;
    layout.value = {
      ...value,
      hidden: value.hidden.includes(id)
        ? value.hidden.filter((x) => x !== id)
        : [...value.hidden, id],
    };
  }
  function move(id: string, direction: number) {
    const order = sections.map((s) => s.id),
      index = order.indexOf(id),
      next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return;
    editRevision++;
    [order[index], order[next]] = [order[next], order[index]];
    layout.value = { ...layout.value, order };
  }
</script>

<svelte:head><title>{m.nav_personalHome()} · MINION hub</title></svelte:head>
<PageShell archetype="collection" labelledBy="personal-home-title">
  <PageHeader
    titleId="personal-home-title"
    title={selected?.label ?? m.nav_personalHome()}
    subtitle={selectedId ? undefined : m.nav_personalDescription()}
  />
  <PageBody>
    <div class="personal-home">
      {#if selectedId}
        <Button href="/account/home" variant="ghost">{m.nav_backPersonalHome()}</Button>
        {#if selected}
          {#if selected.items.length}
            <div class="section-pages">
              {#each selected.items as item (item.id)}<Button href={item.href} variant="outline"
                  >{item.label}</Button
                >{/each}
            </div>
          {:else}<EmptyState
              title={m.nav_emptySection()}
              description={m.nav_emptySectionDescription()}
              icon={LayoutGrid}
            />{/if}
        {:else}<EmptyState
            title={m.nav_noSections()}
            description={m.nav_noSectionsDescription()}
          />{/if}
      {:else}
        <SaveIndicator
          status={layout.status}
          message={layout.message}
          onRetry={layout.retry}
          onReview={reviewLatest}
        />
        {#each sections as section, index (section.id)}
          <section class="section-card" aria-label={section.label}>
            <div class="section-title">
              <NavIcon icon={section.icon} size={iconSizes.lg} />
              <h2 class="t-title">{section.label}</h2>
            </div>
            <div class="section-pages">
              {#each section.items as item (item.id)}<a href={item.href} class="page-link t-body"
                  >{item.label}</a
                >{:else}<p class="t-caption">{m.nav_emptySection()}</p>{/each}
            </div>
            <div class="section-actions">
              <Button href={section.href} variant="outline" size="sm">{m.nav_openSection()}</Button>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={!layout.value.hidden.includes(section.id)}
                onclick={() => toggle(section.id)}
                >{layout.value.hidden.includes(section.id)
                  ? m.nav_showInSidebar()
                  : m.nav_hideInSidebar()}</Button
              >
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${m.nav_moveUp()}: ${section.label}`}
                disabled={index === 0}
                onclick={() => move(section.id, -1)}><ArrowUp size={iconSizes.sm} /></Button
              >
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${m.nav_moveDown()}: ${section.label}`}
                disabled={index === sections.length - 1}
                onclick={() => move(section.id, 1)}><ArrowDown size={iconSizes.sm} /></Button
              >
            </div>
          </section>
        {:else}<EmptyState
            title={m.nav_noSections()}
            description={m.nav_noSectionsDescription()}
          />{/each}
      {/if}
    </div>
  </PageBody>
</PageShell>

<style>
  .personal-home {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-page-gutter);
    min-width: 0;
  }
  .section-card {
    padding: var(--space-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    min-width: 0;
  }
  .section-title,
  .section-actions,
  .section-pages {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    min-width: 0;
  }
  .section-title h2 {
    overflow-wrap: anywhere;
  }
  .section-pages {
    margin: var(--space-3) 0;
    color: var(--color-text-secondary);
  }
  .page-link {
    color: var(--color-text-primary);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    overflow-wrap: anywhere;
  }
  .page-link:hover {
    background: var(--color-surface-2);
  }
</style>
