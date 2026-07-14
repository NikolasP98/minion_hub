<script lang="ts">
  // `g`-then-key nav chords (Gmail/Linear style): bare `g` arms a ~1.5s
  // window, the next key jumps to a destination. Built on the hotkey lib's
  // native sequence support (`createHotkeySequence`) — each destination is
  // its own ['G', <letter>] sequence, so arming/timeout/reset are handled
  // by the manager, not a hand-rolled listener.
  import { goto } from '$app/navigation';
  import { createHotkey, createHotkeySequence, getHotkeyRegistrations } from '$lib/hotkeys';
  import { palettePageRoutes } from '$lib/nav/routes';
  import { BUILTIN_PLUGIN_ITEMS } from '$lib/components/layout/sections';
  import { canViewPath } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';

  // Hand-rolled path → single-letter mnemonic. Deliberately short — only the
  // handful of top-level destinations worth a one-key jump, not every route
  // in the two registries. `G` is reserved as the chord initiator, so it's
  // never assigned as a destination letter.
  const CHORD_DEFS = [
    { key: 'H', path: '/home' },
    { key: 'O', path: '/overview' },
    { key: 'T', path: '/team' },
    { key: 'A', path: '/agents' },
    { key: 'B', path: '/brains' },
    { key: 'C', path: '/crm' },
    { key: 'D', path: '/cloud' },
    { key: 'F', path: '/finances' },
    { key: 'K', path: '/stock' },
    { key: 'P', path: '/pos' },
    { key: 'W', path: '/workforce' },
    { key: 'R', path: '/reliability' },
    { key: 'S', path: '/settings' },
  ] as const;

  // Literal union ('H' | 'O' | ... ) preserved from the `as const` array so
  // `createHotkeySequence(['G', c.key], ...)` type-checks against `Hotkey`
  // without a cast.
  type ChordKey = (typeof CHORD_DEFS)[number]['key'];

  interface Chord {
    key: ChordKey;
    path: string;
    label: () => string;
    enabled: () => boolean;
  }

  const routes = palettePageRoutes();
  const pluginItems = BUILTIN_PLUGIN_ITEMS.map((e) => e.item);

  // Resolve each hand-rolled entry against the two canonical nav registries
  // (existence check), then gate every destination through the route authority.
  const chords: Chord[] = CHORD_DEFS.map((c): Chord | null => {
    const route = routes.find((r) => r.path === c.path);
    if (route) {
      return {
        key: c.key,
        path: c.path,
        label: () => route.title(),
        enabled: () => canViewPath(c.path),
      };
    }
    const item = pluginItems.find((i) => i.href === c.path);
    if (item) {
      return {
        key: c.key,
        path: c.path,
        label: () => item.label,
        enabled: () => canViewPath(c.path),
      };
    }
    return null;
  }).filter((c): c is Chord => c !== null);

  for (const c of chords) {
    createHotkeySequence(
      ['G', c.key],
      () => goto(c.path),
      () => ({
        enabled: c.enabled(),
        timeout: 1500,
      }),
    );
  }

  // Meta-only passthrough (no-op callback) so the `?` cheat-sheet can list
  // the chord — the real navigation fires from the per-destination
  // sequences above, which never carry `meta` themselves (there'd be one
  // noisy row per destination instead of one summary row).
  createHotkey('G', () => {}, {
    meta: { name: m.shortcuts_gNavName(), description: m.shortcuts_gNavDescription() },
  });

  const registrations = getHotkeyRegistrations();

  // "Armed" = the user just pressed G and a g-sequence is mid-match,
  // waiting on its second key. Every chord above starts with 'G', so they
  // all advance together on that keydown and all reset together on
  // whatever key (or Escape, or the 1.5s timeout) follows.
  const armed = $derived(
    registrations.sequences.some((s) => s.sequence[0] === 'G' && s.matchedStepCount > 0),
  );
  const visibleChords = $derived(chords.filter((c) => c.enabled()));
</script>

{#if armed}
  <div
    class="fixed bottom-[max(var(--space-4,16px),env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 z-[var(--layer-command,70)] flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg2 border border-border shadow-[var(--shadow-elevation-4,var(--shadow-lg))] max-w-[calc(100vw-var(--space-page-gutter,16px)-var(--space-page-gutter,16px))] overflow-x-auto"
    style="animation: gnav-in 100ms ease-out"
  >
    {#each visibleChords as c (c.key)}
      <span class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg3 border border-border">
        <kbd class="font-mono text-[11px] font-semibold text-foreground">{c.key}</kbd>
        <span class="text-[11px] text-muted-foreground whitespace-nowrap">{c.label()}</span>
      </span>
    {/each}
  </div>
{/if}

<style>
  @keyframes gnav-in {
    from {
      opacity: 0;
      transform: translate(-50%, 4px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
