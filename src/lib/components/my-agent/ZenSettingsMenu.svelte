<script lang="ts">
  import { Button } from '$lib/components/ui';
  import type { ButtonProps } from '@minion-stack/ui';

  // Zen editor-settings cog — Zag nested menu (root → Spelling / View).
  // Spelling: spellcheck toggle + language radio. View: toggle the zen
  // word-count meta (top-left) and hotkey hints (bottom-left).
  import * as menu from '@zag-js/menu';
  import { portal, normalizeProps, useMachine } from '@zag-js/svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { Check, ChevronRight, Settings } from 'lucide-svelte';
  import {
    txPrefs,
    setNoteLang,
    setSpellcheck,
    setShowMeta,
    setShowHints,
    NOTE_LANGS,
    type NoteLang,
  } from '$lib/state/features/transcription-prefs.svelte';

  const id = $props.id();

  const LANG_LABELS: Record<NoteLang, () => string> = {
    auto: () => m.note_langAuto(),
    es: () => m.note_langEs(),
    en: () => m.note_langEn(),
  };

  const rootService = useMachine(menu.machine as any, () => ({
    id: `${id}-root`,
    'aria-label': m.note_editorSettings(),
    positioning: { placement: 'bottom-end' as const },
  }));
  const root = $derived(menu.connect(rootService as any, normalizeProps));

  const spellService = useMachine(menu.machine as any, () => ({
    id: `${id}-spelling`,
    closeOnSelect: false,
    onSelect({ value }: { value: string }) {
      if (value === 'spellcheck') setSpellcheck(!txPrefs.spellcheck);
      else if (value.startsWith('lang:')) setNoteLang(value.slice(5) as NoteLang);
    },
  }));
  const spellMenu = $derived(menu.connect(spellService as any, normalizeProps));

  const viewService = useMachine(menu.machine as any, () => ({
    id: `${id}-view`,
    closeOnSelect: false,
    onSelect({ value }: { value: string }) {
      if (value === 'meta') setShowMeta(!txPrefs.showMeta);
      else if (value === 'hints') setShowHints(!txPrefs.showHints);
    },
  }));
  const viewMenu = $derived(menu.connect(viewService as any, normalizeProps));

  onMount(() => {
    root.setChild(spellService as any);
    spellMenu.setParent(rootService as any);
    root.setChild(viewService as any);
    viewMenu.setParent(rootService as any);
  });

  const asButtonProps = (props: unknown) => props as ButtonProps;
</script>

<Button
  {...asButtonProps(root.getTriggerProps())}
  class="zs-trigger {root.open ? 'on' : ''}"
  title={m.note_editorSettings()}
  aria-label={m.note_editorSettings()}
>
  <Settings size={16} />
</Button>

<div use:portal {...root.getPositionerProps()} style:z-index="96">
  <div {...root.getContentProps()} class="zs-menu">
    <Button {...asButtonProps(root.getTriggerItemProps(spellMenu))} class="zs-item">
      {m.note_spelling()}
      <ChevronRight size={13} class="zs-chev" />
    </Button>
    <Button {...asButtonProps(root.getTriggerItemProps(viewMenu))} class="zs-item">
      {m.note_view()}
      <ChevronRight size={13} class="zs-chev" />
    </Button>
  </div>
</div>

<div use:portal {...spellMenu.getPositionerProps()} style:z-index="97">
  <div {...spellMenu.getContentProps()} class="zs-menu">
    <Button {...asButtonProps(spellMenu.getItemProps({ value: 'spellcheck' }))} class="zs-item">
      <span class="zs-check" class:on={txPrefs.spellcheck}>
        {#if txPrefs.spellcheck}<Check size={11} />{/if}
      </span>
      {m.note_spellcheck()}
    </Button>
    <div class="zs-sep"></div>
    <div class="zs-label">{m.note_language()}</div>
    {#each NOTE_LANGS as lang (lang)}
      <Button {...asButtonProps(spellMenu.getItemProps({ value: `lang:${lang}` }))} class="zs-item">
        <span class="zs-radio" class:on={txPrefs.lang === lang}></span>
        {LANG_LABELS[lang]()}
      </Button>
    {/each}
  </div>
</div>

<div use:portal {...viewMenu.getPositionerProps()} style:z-index="97">
  <div {...viewMenu.getContentProps()} class="zs-menu">
    <Button {...asButtonProps(viewMenu.getItemProps({ value: 'meta' }))} class="zs-item">
      <span class="zs-check" class:on={txPrefs.showMeta}>
        {#if txPrefs.showMeta}<Check size={11} />{/if}
      </span>
      {m.note_showMeta()}
    </Button>
    <Button {...asButtonProps(viewMenu.getItemProps({ value: 'hints' }))} class="zs-item">
      <span class="zs-check" class:on={txPrefs.showHints}>
        {#if txPrefs.showHints}<Check size={11} />{/if}
      </span>
      {m.note_showHints()}
    </Button>
  </div>
</div>

<style>
  :global(.zs-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2);
    border-radius: var(--radius-xl);
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
    background: transparent;
    border: none;
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  :global(.zs-trigger):hover,
  :global(.zs-trigger):global(.on) {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
  }
  .zs-menu {
    min-width: 190px;
    display: flex;
    flex-direction: column;
    padding: var(--space-1);
    border-radius: var(--radius-xl);
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-overlay);
    outline: none;
  }
  :global(.zs-item) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    font-size: var(--font-size-caption);
    font-family: inherit;
    text-align: left;
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 82%, transparent);
    transition:
      background var(--duration-fast) ease,
      color var(--duration-fast) ease;
  }
  :global(.zs-item):hover,
  :global(.zs-item)[data-highlighted] {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  :global(.zs-item) :global(.zs-chev) {
    margin-left: auto;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  .zs-label {
    padding: var(--space-1) var(--space-2) var(--space-0-5);
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
  }
  .zs-sep {
    height: 1px;
    margin: var(--space-1) var(--space-1);
    background: var(--color-border);
  }
  .zs-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: var(--radius-sm);
    border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
    flex-shrink: 0;
  }
  .zs-check:global(.on) {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .zs-check :global(svg) {
    color: var(--color-accent-foreground, var(--color-foreground));
  }
  .zs-radio {
    width: 13px;
    height: 13px;
    border-radius: var(--radius-full);
    border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
    flex-shrink: 0;
    position: relative;
  }
  .zs-radio:global(.on) {
    border-color: var(--color-accent);
  }
  .zs-radio:global(.on)::after {
    content: '';
    position: absolute;
    inset: 2.5px;
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }
</style>
