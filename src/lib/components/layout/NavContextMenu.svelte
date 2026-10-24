<script lang="ts">
  /**
   * Right-click / ContextMenu key / Shift+F10 / long-press menus for the nav (meta spec 037, S4).
   * One host per nav item, section header, or empty nav area. Everyone keeps "Set as home page";
   * structural entries need `settings:manage`. Items stop propagation so the area host only
   * opens on empty space.
   */
  import type { Snippet } from 'svelte';
  import {
    Check,
    ClipboardPaste,
    Copy,
    CopyPlus,
    Eye,
    EyeOff,
    FolderInput,
    Pencil,
    Plus,
    Trash2,
    Undo2,
    Star,
  } from 'lucide-svelte';
  import ContextMenu, { type ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
  import Picker from '$lib/components/ui/Picker.svelte';
  import { Button, Input } from '$lib/components/ui';
  import { Dialog, ConfirmDialog, FormField } from '$lib/components/ui/foundations';
  import { page } from '$app/state';
  import { invalidate } from '$lib/navigation';
  import { canonicalPath } from '$lib/canonical-path';
  import { longpress } from '$lib/actions/longpress';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';
  import { getModules } from '$lib/nav/modules';
  import { navConfig } from '$lib/nav/nav-config.svelte';
  import {
    NavSaveError,
    canEditNav,
    navClipboard,
    newIssues,
    saveNavConfig,
  } from '$lib/nav/nav-edit.svelte';
  import {
    addLink,
    addSection,
    aliasableTargets,
    duplicatePage,
    instancePath,
    moveBuiltin,
    movePage,
    removePage,
    removeSection,
    reservedSectionSlugs,
    renameBuiltin,
    renamePage,
    renameSection,
    resolveNavInstance,
    setHidden,
    slugify,
    type NavConfig,
    type NavConfigIssue,
    type NavPage,
    type NavSection,
  } from '$lib/nav/custom-sections';

  interface Props {
    kind: 'item' | 'header' | 'area';
    /** item: the row's href (built-in screen or instance path). */
    href?: string;
    label?: string;
    /** header: `custom:<id>` of a custom section (the sidebar's section id). */
    sectionId?: string;
    /** header: a built-in module's id (module-mode group head). */
    module?: string;
    children: Snippet;
  }
  let { kind, href = '', label = '', sectionId, module, children }: Props = $props();

  const customId = $derived(sectionId?.startsWith('custom:') ? sectionId.slice(7) : null);
  /** A built-in full-mode header has no menu of its own: the area menu serves it. */
  const inert = $derived(kind === 'header' && !customId && !module);

  const targets = aliasableTargets();
  const targetSet = new Set(targets.map((t) => t.pattern));
  const titleOf = (target: string) => targets.find((t) => t.pattern === target)?.title ?? target;

  // ── what the host stands for ──────────────────────────────────────────────
  const config = $derived(navConfig());
  const canonical = $derived(canonicalPath(href));
  const instance = $derived(kind === 'item' ? resolveNavInstance(config, canonical) : null);
  /** A built-in page in its native nav (aliasable screen, not an instance URL). */
  const builtinTarget = $derived(
    kind === 'item' && !instance && targetSet.has(canonical) ? canonical : null,
  );
  const customSection = $derived<NavSection | null>(
    customId ? (config.sections.find((s) => s.id === customId) ?? null) : null,
  );
  const currentHome = $derived(
    ((page.data as { preferences?: { preferences?: Record<string, unknown> } })?.preferences
      ?.preferences?.landingPage as string | undefined) ?? '/home',
  );

  async function setAsHome() {
    if (currentHome === href) return;
    try {
      await fetch('/api/me/preferences/landingPage', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: href }),
      });
      await invalidate('app:preferences');
    } catch {
      /* best-effort; non-blocking */
    }
  }

  const toggled = (hidden?: boolean) => (hidden ? m.nav_menu_show() : m.nav_menu_hide());

  // ── the entries (spec §Operations) ────────────────────────────────────────
  function brokenOrHidden(): ContextMenuItem[] {
    const out: ContextMenuItem[] = [];
    const reserved = reservedSectionSlugs();
    for (const s of config.sections) {
      if (reserved.has(s.slug))
        out.push({
          id: `delete:section:${s.id}`,
          label: `${s.label} — ${m.nav_warning_reserved_now()}`,
          icon: Trash2,
          danger: true,
        });
      else if (s.hidden) out.push({ id: `show:section:${s.id}`, label: s.label, icon: Eye });
      for (const p of s.pages) {
        if (!targetSet.has(p.target))
          out.push({
            id: `delete:page:${p.id}`,
            label: `${p.label} — ${m.nav_warning_target_gone()}`,
            icon: Trash2,
            danger: true,
          });
        else if (p.hidden)
          out.push({ id: `show:page:${p.id}`, label: `${s.label} › ${p.label}`, icon: Eye });
      }
    }
    for (const [module, pages] of Object.entries(config.builtinSections))
      for (const p of pages)
        if (p.hidden)
          out.push({ id: `show:page:${p.id}`, label: `${module} › ${p.label}`, icon: Eye });
    for (const [target, o] of Object.entries(config.builtin))
      if (o.hidden)
        out.push({
          id: `show:builtin:${target}`,
          label: o.label ?? titleOf(target),
          icon: Eye,
        });
    return out;
  }

  const items = $derived.by<ContextMenuItem[]>(() => {
    const out: ContextMenuItem[] = [];
    if (kind === 'item') {
      out.push({
        id: 'home',
        label: currentHome === href ? m.nav_isHome() : m.nav_setAsHome(),
        icon: Star,
        selection: 'checkbox',
        checked: currentHome === href,
      });
      if (!canEditNav()) return out;
      const target = instance?.target ?? builtinTarget;
      if (!target) return out;
      out.push({ id: 'copy', label: m.nav_menu_copy(), icon: Copy });
      out.push({ id: 'duplicate', label: m.nav_menu_duplicate(), icon: CopyPlus });
      out.push({ id: 'move', label: m.nav_menu_move(), icon: FolderInput });
      out.push({ id: 'rename', label: m.nav_menu_rename(), icon: Pencil });
      out.push({
        id: 'hide',
        label: toggled(instance?.page.hidden ?? config.builtin[target]?.hidden),
        icon: instance?.page.hidden || config.builtin[target]?.hidden ? Eye : EyeOff,
      });
      if (instance?.page.kind === 'main')
        out.push({
          id: 'restore',
          label: m.nav_menu_restore({ path: instance.target }),
          icon: Undo2,
        });
      else if (instance)
        out.push({ id: 'delete', label: m.nav_menu_delete(), icon: Trash2, danger: true });
      // TODO(handoff): "Access…" (users:manage) is omitted until S5 ships PageAccessDialog — add `access` here.
    } else if (kind === 'header') {
      if (!canEditNav()) return out;
      const paste = {
        id: 'paste',
        label: m.nav_menu_paste(),
        icon: ClipboardPaste,
        disabled: !navClipboard.item,
      };
      if (customSection) {
        out.push({ id: 'new-page', label: m.nav_menu_new_page(), icon: Plus });
        out.push(paste);
        out.push({ id: 'rename', label: m.nav_menu_rename(), icon: Pencil });
        out.push({
          id: 'hide',
          label: toggled(customSection.hidden),
          icon: customSection.hidden ? Eye : EyeOff,
        });
        // TODO(handoff): section "Access…" (users:manage) arrives with S5.
        out.push({
          id: 'delete-section',
          label: m.nav_menu_delete_section(),
          icon: Trash2,
          danger: true,
        });
      } else if (module) out.push(paste);
    } else {
      if (!canEditNav()) return out;
      out.push({ id: 'new-section', label: m.nav_menu_new_section(), icon: Plus });
      out.push({
        id: 'paste-into',
        label: m.nav_menu_paste_into(),
        icon: ClipboardPaste,
        disabled: !navClipboard.item || config.sections.length === 0,
        children: config.sections.map((s) => ({ id: `paste:${s.id}`, label: s.label })),
      });
      const hidden = brokenOrHidden();
      out.push({
        id: 'not-shown',
        label: m.nav_menu_not_shown(),
        icon: EyeOff,
        disabled: hidden.length === 0,
        children: hidden,
      });
    }
    return out;
  });

  // ── openers ───────────────────────────────────────────────────────────────
  let at = $state<{ x: number; y: number } | null>(null);
  let returnTo: HTMLElement | null = null;

  function open(e: MouseEvent | KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (
      e.defaultPrevented ||
      !items.length ||
      el.closest('input,textarea,[contenteditable="true"],dialog,[role="menu"]')
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    returnTo = el.closest<HTMLElement>('a,[tabindex]') ?? el;
    if (e instanceof MouseEvent) at = { x: e.clientX, y: e.clientY };
    else {
      const r = el.getBoundingClientRect();
      at = { x: r.left, y: r.bottom };
    }
  }
  const onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) open(e);
  };
  function openAt(p: { x: number; y: number }) {
    if (!items.length) return;
    returnTo = null;
    at = p;
  }
  function close() {
    at = null;
    returnTo?.focus({ preventScroll: true });
  }

  // ── dialogs ───────────────────────────────────────────────────────────────
  type Dlg =
    | { t: 'rename' }
    | { t: 'new-section' }
    | { t: 'new-page' }
    | { t: 'move' }
    | { t: 'delete' }
    | { t: 'restore' }
    | { t: 'delete-section' };
  let fLabel = $state('');
  let fSlug = $state('');
  let slugEdited = $state(false);
  let serverIssues = $state<NavConfigIssue[]>([]);
  let pending = $state(false);

  let dlg = $state<Dlg | null>(null);
  let dlgOpen = $state(false);
  const openDlg = (d: Dlg) => {
    if (d.t === 'rename') {
      fLabel =
        instance?.page.label ??
        customSection?.label ??
        config.builtin[builtinTarget ?? '']?.label ??
        label;
      fSlug = instance?.page.slug ?? customSection?.slug ?? '';
      slugEdited = true;
    } else if (d.t === 'new-section') {
      fLabel = '';
      fSlug = '';
      slugEdited = false;
    }
    serverIssues = [];
    dlg = d;
    dlgOpen = true;
  };
  const closeDlg = () => {
    dlg = null;
    dlgOpen = false;
  };

  /** Fire-and-toast for ops without a dialog: a refused save is surfaced, never swallowed. */
  async function run(op: (c: NavConfig) => NavConfig) {
    try {
      await saveNavConfig(op);
    } catch (e) {
      if (e instanceof NavSaveError && !e.toasted) toastError(e.message);
      // other failures already reached the user through saveNavConfig's toast
    }
  }

  function onselect(item: ContextMenuItem) {
    close();
    const id = item.id;
    const clip = navClipboard.item;
    const pageId = instance?.page.id;
    if (id === 'home') return void setAsHome();
    if (id === 'copy') {
      const target = instance?.target ?? builtinTarget;
      if (target)
        navClipboard.item = {
          target,
          label: instance?.page.label ?? config.builtin[target]?.label ?? label,
          ...(instance?.page.icon ? { icon: instance.page.icon } : {}),
        };
      return;
    }
    if (id === 'duplicate') {
      const bt = builtinTarget;
      return void run((c) =>
        pageId
          ? duplicatePage(c, { pageId })
          : duplicatePage(c, { target: bt!, module: bt!.split('/')[1] }),
      );
    }
    if (id === 'hide') {
      // Decided once: `run` applies the op twice (optimistic view, then stored document).
      const hidden = !(
        customSection?.hidden ??
        instance?.page.hidden ??
        config.builtin[builtinTarget ?? '']?.hidden
      );
      const ref = customSection
        ? { sectionId: customSection.id }
        : pageId
          ? { pageId }
          : { target: builtinTarget! };
      return void run((c) => setHidden(c, ref, hidden));
    }
    if (id === 'paste' && clip) {
      return void run((c) =>
        addLink(c, customId ? { sectionId: customId } : { module: module! }, clip),
      );
    }
    if (id.startsWith('paste:') && clip)
      return void run((c) => addLink(c, { sectionId: id.slice(6) }, clip));
    if (id.startsWith('show:')) {
      const [, what, ...r] = id.split(':');
      const rest = r.join(':');
      return void run((c) =>
        setHidden(
          c,
          what === 'section'
            ? { sectionId: rest }
            : what === 'page'
              ? { pageId: rest }
              : { target: rest },
          false,
        ),
      );
    }
    if (id.startsWith('delete:page:')) return void run((c) => removePage(c, id.slice(12)));
    if (id.startsWith('delete:section:')) return void run((c) => removeSection(c, id.slice(15)));
    if (
      id === 'rename' ||
      id === 'new-section' ||
      id === 'new-page' ||
      id === 'move' ||
      id === 'delete' ||
      id === 'restore' ||
      id === 'delete-section'
    )
      openDlg({ t: id });
  }

  // Rename / New section form ───────────────────────────────────────────────
  const hasSlug = $derived(dlg?.t === 'new-section' || !!instance || !!customSection);
  const draftOp = $derived.by<((c: NavConfig) => NavConfig) | null>(() => {
    if (dlg?.t === 'new-section') return (c) => addSection(c, { label: fLabel, slug: fSlug });
    if (dlg?.t !== 'rename') return null;
    if (instance) return (c) => renamePage(c, instance.page.id, { label: fLabel, slug: fSlug });
    if (customSection)
      return (c) => renameSection(c, customSection.id, { label: fLabel, slug: fSlug });
    if (builtinTarget) return (c) => renameBuiltin(c, builtinTarget, fLabel.trim() ? fLabel : null);
    return null;
  });
  const issueText = (i: NavConfigIssue): { field: 'label' | 'slug' | 'form'; text: string } => {
    switch (i.code) {
      case 'slug.reserved':
        return { field: 'slug', text: m.nav_error_reserved() };
      case 'slug.format':
        return { field: 'slug', text: m.nav_error_format() };
      case 'slug.duplicate':
        return { field: 'slug', text: m.nav_error_duplicate() };
      case 'label.length':
        return { field: 'label', text: m.nav_error_label() };
      default:
        return { field: 'form', text: i.message };
    }
  };
  const draftIssues = $derived(draftOp ? newIssues(config, draftOp(config)) : []);
  const shown = $derived([...draftIssues, ...serverIssues].map(issueText));
  const errorFor = (f: 'label' | 'slug' | 'form') => shown.find((s) => s.field === f)?.text;
  // Built-in labels may be emptied (that resets the override); everything else needs a label.
  const canSave = $derived(
    !pending &&
      !!draftOp &&
      draftIssues.length === 0 &&
      (builtinTarget && dlg?.t === 'rename' ? true : fLabel.trim().length > 0),
  );
  const urlPreview = $derived.by(() => {
    if (dlg?.t === 'new-section') return `/${fSlug}`;
    if (instance) return instancePath(instance.sectionSlug, { slug: fSlug, id: instance.page.id });
    if (customSection) return `/${fSlug}`;
    return '';
  });

  function onLabelInput() {
    if (dlg?.t === 'new-section' && !slugEdited) fSlug = slugify(fLabel);
  }

  async function submitForm() {
    if (!canSave || !draftOp) return;
    pending = true;
    try {
      await saveNavConfig(draftOp);
      closeDlg();
    } catch (e) {
      if (e instanceof NavSaveError) serverIssues = e.issues.length ? e.issues : [];
    } finally {
      pending = false;
    }
  }

  // Move picker rows ────────────────────────────────────────────────────────
  type Dest = { id: string; title: string; path: string; sectionId?: string; module?: string };
  const destinations = $derived.by<Dest[]>(() => {
    const rows: Dest[] = config.sections
      .filter((s) => s.id !== instance?.sectionId)
      .map((s) => ({ id: `s:${s.id}`, title: s.label, path: `/${s.slug}`, sectionId: s.id }));
    // Built-in modules can receive instances; a built-in main-to-be needs a custom section.
    if (instance)
      for (const mod of getModules())
        if (mod.id !== instance.sectionSlug)
          rows.push({ id: `m:${mod.id}`, title: mod.label, path: `/${mod.id}`, module: mod.id });
    return rows;
  });
  function moveTo(d: Dest) {
    const dest = d.sectionId ? { sectionId: d.sectionId } : { module: d.module! };
    const pageId = instance?.page.id;
    const target = builtinTarget;
    const name = config.builtin[target ?? '']?.label ?? label;
    void run((c) =>
      pageId ? movePage(c, pageId, dest) : moveBuiltin(c, target!, d.sectionId!, name),
    );
  }
  // The page id is read once: the optimistic view drops the entry before the stored-document pass.
  function removeInstance() {
    const id = instance!.page.id;
    return saveNavConfig((c) => removePage(c, id));
  }
  function linkTo(row: { pattern: string; title: string }) {
    if (customId)
      void run((c) =>
        addLink(c, { sectionId: customId }, { target: row.pattern, label: row.title }),
      );
  }
</script>

{#if inert}
  {@render children()}
{:else}
  <!-- display:contents: the host adds no box, so nav layout (flex gaps, hit areas) is unchanged. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="nav-context-host" oncontextmenu={open} {onkeydown} use:longpress={openAt}>
    {@render children()}
  </div>
{/if}
{#if at && items.length}
  <ContextMenu {...at} {items} label={m.nav_menu_label()} onclose={close} {onselect} />
{/if}

{#if dlg && (dlg.t === 'rename' || dlg.t === 'new-section')}
  <Dialog
    bind:open={dlgOpen}
    title={dlg.t === 'rename' ? m.nav_menu_rename() : m.nav_menu_new_section()}
    size="sm"
    onclose={closeDlg}
  >
    <form
      id="nav-form"
      class="nav-form"
      onsubmit={(e) => {
        e.preventDefault();
        void submitForm();
      }}
    >
      <FormField label={m.nav_dialog_label()} error={errorFor('label')} required>
        {#snippet children(control)}
          <Input {...control} bind:value={fLabel} oninput={onLabelInput} maxlength={40} />
        {/snippet}
      </FormField>
      {#if hasSlug}
        <FormField
          label={m.nav_dialog_slug()}
          helper={urlPreview ? m.nav_dialog_url_preview({ url: urlPreview }) : undefined}
          error={errorFor('slug')}
          required
        >
          {#snippet children(control)}
            <Input
              {...control}
              bind:value={fSlug}
              oninput={() => (slugEdited = true)}
              maxlength={32}
            />
          {/snippet}
        </FormField>
      {/if}
      {#if errorFor('form')}<p class="nav-form-error" role="alert">{errorFor('form')}</p>{/if}
    </form>
    {#snippet footer()}
      <Button variant="ghost" onclick={closeDlg}>{m.common_cancel()}</Button>
      <Button type="submit" form="nav-form" variant="primary" disabled={!canSave} loading={pending}>
        {m.common_save()}
      </Button>
    {/snippet}
  </Dialog>
{:else if dlg?.t === 'new-page'}
  <Picker
    bind:open={dlgOpen}
    title={m.nav_dialog_pick_screen()}
    columns={[
      {
        key: 'title',
        label: m.nav_dialog_label(),
        emphasis: 'primary',
        priority: 10,
        hideable: false,
      },
      { key: 'pattern', label: m.nav_dialog_path(), priority: 20 },
    ]}
    rows={targets}
    getRowId={(r) => r.pattern}
    searchText={(r) => `${r.title} ${r.pattern}`}
    selectionMode="single"
    onPick={linkTo}
    onclose={closeDlg}
  />
{:else if dlg?.t === 'move'}
  <Picker
    bind:open={dlgOpen}
    title={m.nav_dialog_pick_section()}
    columns={[
      {
        key: 'title',
        label: m.nav_dialog_label(),
        emphasis: 'primary',
        priority: 10,
        hideable: false,
      },
      { key: 'path', label: m.nav_dialog_path(), priority: 20 },
    ]}
    rows={destinations}
    getRowId={(r) => r.id}
    searchText={(r) => `${r.title} ${r.path}`}
    selectionMode="single"
    onPick={moveTo}
    onclose={closeDlg}
  />
{:else if dlg?.t === 'delete'}
  <ConfirmDialog
    bind:open={dlgOpen}
    title={m.nav_menu_delete()}
    message={m.nav_confirm_delete_link()}
    confirmLabel={m.nav_menu_delete()}
    failureMessage={m.common_error()}
    tone="danger"
    onconfirm={() => removeInstance()}
    onclose={closeDlg}
  />
{:else if dlg?.t === 'restore'}
  <ConfirmDialog
    bind:open={dlgOpen}
    title={m.nav_menu_restore({ path: instance?.target ?? '' })}
    message={m.nav_confirm_restore({ path: instance?.target ?? '' })}
    confirmLabel={m.nav_menu_restore({ path: instance?.target ?? '' })}
    failureMessage={m.common_error()}
    onconfirm={() => removeInstance()}
    onclose={closeDlg}
  />
{:else if dlg?.t === 'delete-section'}
  <ConfirmDialog
    bind:open={dlgOpen}
    title={m.nav_menu_delete_section()}
    message={m.nav_confirm_delete_section({ count: customSection?.pages.length ?? 0 })}
    confirmLabel={m.nav_menu_delete()}
    failureMessage={m.common_error()}
    tone="danger"
    onconfirm={() => saveNavConfig((c) => removeSection(c, customId!))}
    onclose={closeDlg}
  />
{/if}

<style>
  .nav-context-host {
    display: contents;
  }
  .nav-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .nav-form-error {
    color: var(--color-destructive);
    font-size: var(--font-size-body);
  }
</style>
