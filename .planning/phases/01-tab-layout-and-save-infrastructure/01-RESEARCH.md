# Phase 01: Tab Layout and Save Infrastructure - Research

**Researched:** 2026-03-11
**Domain:** SvelteKit / Svelte 5 settings page — tabbed navigation, save bar, restart UX, navigation guards
**Confidence:** HIGH (primary analysis is from direct codebase reading — no library unknowns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Merge Channels tab into Comms tab — go from 9 to 8 tabs
- Tab order: Hosts → AI → Agents → Comms → Security → System → Backups → Appearance
- Default landing tab changes from Appearance to Hosts (`?s=hosts`)
- Save bar dismisses after save; restart progress tracked via persistent toast ("Gateway restarting...")
- On reconnect: auto-verify by re-fetching config and comparing with expected state, then show success/warning toast. Auto-dismiss after 3s.
- On timeout (30s): error toast "Gateway didn't reconnect" with a Retry action button
- Non-restart saves: success toast "Settings saved", auto-dismiss after 2-3s
- Save bar shows dirty count only ("3 unsaved changes") — no field list
- Ctrl/Cmd+S triggers same toast confirmation as clicking Save button
- Per-tab scroll position remembered (already free with `visibility:hidden` DOM mounting)
- Expanded/collapsed group state persists in session only — resets on page refresh
- On disconnect with unsaved changes: preserve edits + warning banner "Disconnected — changes will save on reconnect". Auto-save when reconnected.
- Host switch (different gateway): re-fetch with skeleton loader, clear previous config state completely
- Dirty dot only — small colored dot on tabs containing unsaved changes. No error/validation badges in Phase 1.
- Custom styled modal replacing native `confirm()` dialog. Modal has Save / Discard / Cancel buttons.

### Claude's Discretion
- Channels placement within Comms tab (separate card or integrated sections)
- Fields editable vs disabled during restart window
- Tab mounting strategy (all mounted vs lazy mount on first visit)
- Save bar position (sticky bottom vs floating)
- Loading skeleton design
- Exact spacing and typography

### Deferred Ideas (OUT OF SCOPE)
- Validation error badges on tabs — Phase 3
- Config diff preview before saving — Phase 3
- Per-field dirty indicators — Phase 2
- Card-based grouping — Phase 2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LAYOUT-01 | Top-level tabbed navigation (8 tabs in specified order) | Tab order and merge confirmed by reading `SettingsTabBar.svelte` + `config-schema.ts` TABS array. Surgery is: remove `channels` from TABS, update `SettingsTabBar.ALL_TABS`, update `HUB_TAB_IDS` set, add Channels rendering inside Comms panel. |
| LAYOUT-04 | Loading skeleton shown while config loads | `SettingsSkeleton.svelte` exists; also `src/lib/components/ui/Skeleton.svelte` for atomic use. Already wired in settings page via `configState.loading && !configState.loaded`. |
| LAYOUT-05 | Page matches existing Minion Hub theming | All CSS variables, Tailwind v4, `bg-card`, `border-border`, `text-foreground` already used throughout. No theme system changes needed. |
| SAVE-02 | User warned before navigating away with unsaved changes (browser + in-app) | `beforeNavigate` + `beforeunload` already implemented — replace native `confirm()` with custom modal component. |
| SAVE-03 | Save via Ctrl/Cmd+S | `handleKeydown` already in `onMount` of settings page — currently calls `save()`. After Phase 1, it should also fire toast feedback. |
| INTG-01 | Config changes confirmed as applied via config.patch WS response | `save()` in `config.svelte.ts` sends `config.patch` and awaits response. Success branch calls `toastSuccess('Config saved')`. Already functional — needs toast for restart path too. |
| INTG-02 | After restart-triggering save, user sees restarting indicator and auto-recovers | Restart state machine exists (`config-restart.ts`). `onRestartReconnected()` is called in `gateway.svelte.ts` `onHelloOk`. Currently wired to a save-bar state; needs migration to toast. |
| PLSH-01 | Restart indicator persists and shows recovery status | Persistent toast approach replaces the current bottom bar for restart state. `toastLoading` with `duration: Infinity` can be the persistent toast, then replaced on reconnect/fail. |
| PLSH-03 | Connection loss with unsaved changes: preserve edits + warning banner, auto-save on reconnect | Not yet implemented. Needs: disconnect detection in settings page (watch `conn.connected`), warning banner component or toast, and auto-save trigger on reconnect. |
</phase_requirements>

---

## Summary

This phase is primarily a **hardening and reorganisation** effort on existing working infrastructure, not a greenfield build. The settings page (`src/routes/settings/+page.svelte`, 443 lines) already has tab switching, CSS visibility panels, navigation guards, skeleton loading, save bar, and a restart state machine. The required changes are surgical:

1. **Tab reorganisation** — remove `channels` tab, add Channels rendering inside Comms panel, change default tab to `hosts`, update tab order constant in two places (`SettingsTabBar.ALL_TABS` and `TABS` in `config-schema.ts`).
2. **Save UX migration** — replace the `ConfigSaveBar` restart states with a persistent toast approach. The `toastLoading` function already supports `duration: Infinity`. The existing `restartState` machine is already pure and well-tested.
3. **Navigation guard upgrade** — replace `window.confirm()` (one call in settings page) with a custom Svelte 5 modal component matching app theme.
4. **Disconnect-with-dirty-edits** — new logic: watch `conn.connected`, when it drops while `isDirty.value` is true, show a warning banner and queue an auto-save for when `conn.connected` goes true again.
5. **Dirty tab dots** — add per-tab dirty dot indicator to `SettingsTabBar`. Requires computing which tab IDs have dirty fields, which can be derived from `dirtyPaths` + group→tab mapping already in `config-schema.ts`.

**Primary recommendation:** Work file-by-file in dependency order — `config-schema.ts` → `SettingsTabBar.svelte` → `settings/+page.svelte` → `config.svelte.ts` (toast migration) → new `NavigationGuardModal.svelte`. The restart state machine pure functions need no changes; only the UI layer wiring changes.

---

## Standard Stack

### Core (already in project — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte 5 | ^5.0 | Component reactivity — `$state`, `$derived`, `$effect`, `$props` | Project standard |
| SvelteKit 2 | ^2.52 | `beforeNavigate`, `goto`, `page` from `$app/state` | Project standard |
| `@zag-js/toast` | ^1.x (already installed) | Toast notifications — `toastLoading`, `toastSuccess`, `toastError`, `toastInfo` | Already used in project |
| Tailwind CSS v4 | ^4.2 | Utility classes for layout, spacing, colour | Project standard |
| Lucide Svelte | ^0.575 | Tab icons (Brain, Bot, Radio, Shield, Server, Palette, HardDrive, DatabaseBackup) | Project standard |

**No new packages needed for this phase.**

### Toast API — Verified Capabilities

The project uses `@zag-js/toast` via `src/lib/state/ui/toast.svelte.ts`. Available factory functions:

```typescript
// Persistent (use for "Gateway restarting...")
toastLoading(title, description?, { duration: Infinity })

// Auto-dismiss after 4s
toastSuccess(title, description?)   // duration: 4000

// Auto-dismiss after 8s
toastError(title, description?)     // duration: 8000

// Auto-dismiss after 6s
toastWarning(title, description?)   // duration: 6000

// Custom duration
toaster.create({ title, type: 'loading', duration: Infinity })
```

The `toaster` store is also exported, allowing `toaster.dismiss(id)` to remove a specific toast by the ID returned from `toaster.create(...)`. This is the mechanism for replacing the "Gateway restarting..." toast with a success or error toast on reconnect.

---

## Architecture Patterns

### Existing: CSS Visibility Panel Pattern

All tabs are always mounted in DOM. Switching tabs only toggles `visibility` and `z-index`. This gives free scroll-position preservation.

```svelte
<!-- Pattern used throughout settings page -->
<div
  class="tab-panel absolute inset-0 flex flex-col overflow-hidden"
  style:visibility={activeTab === 'hosts' ? 'visible' : 'hidden'}
  style:z-index={activeTab === 'hosts' ? 1 : 0}
  role="tabpanel"
>
```

**Phase 1 recommendation:** Keep this pattern for all tabs including Comms (which will absorb Channels content). Lazy mounting is a viable alternative but the visibility pattern is already battle-tested here and eliminates scroll-state complexity.

### Existing: URL-Persisted Active Tab

```typescript
// Read
const activeTab = $derived(page.url.searchParams.get("s") ?? "hosts"); // change default to "hosts"

// Write
function selectTab(id: string) {
  goto(`?s=${id}`, { replaceState: true, noScroll: true });
}
```

**Change needed:** Only update the default from `"appearance"` to `"hosts"`.

### Existing: Tab Definition Data Structure

Two places define tabs and must stay in sync:

1. `src/lib/utils/config-schema.ts` — `TABS` array and `TAB_MAPPING` record (drives gateway config group routing)
2. `src/lib/components/settings/SettingsTabBar.svelte` — `ALL_TABS` array (drives visual tab bar)

**Phase 1 change:** Remove `channels` entry from both, ensure Comms panel in settings page renders ChannelsTab content inline.

### New: Dirty Tab Dots

A tab has a dirty dot when any of its config groups has at least one dirty path. The derivation chain:

```
dirtyPaths (Set<string>)  →  dirtyGroupIds (Set<string>)  →  dirtyTabIds (Set<string>)
```

`dirtyGroupIds` is already computed in `settings/+page.svelte`. Adding `dirtyTabIds` requires mapping group IDs back to tab IDs using `TAB_MAPPING` + `SECURITY_GROUP_IDS`. This logic can live in the settings page as a `$derived.by()`.

```typescript
// New derived in settings page
const dirtyTabIds = $derived.by(() => {
  const result = new Set<string>();
  for (const groupId of dirtyGroupIds) {
    // security carve-out
    if (SECURITY_GROUP_IDS.has(groupId)) { result.add('security'); continue; }
    // check each gateway tab
    for (const [tabId, metaGroupIds] of Object.entries(TAB_MAPPING)) {
      if (metaGroupIds.length === 0) continue;
      const groupOrder = groups.value.find(g => g.id === groupId)?.order ?? 0;
      const metaId = getMetaGroupId(groupOrder);
      if (metaGroupIds.includes(metaId)) { result.add(tabId); break; }
    }
  }
  return result;
});
```

Pass `dirtyTabIds` as a prop to `SettingsTabBar`. Inside SettingsTabBar, show a small dot for each dirty tab.

### New: Restart → Toast Migration

Current flow uses `ConfigSaveBar` with phase-conditional rendering. New flow:

```
save() called
  → config.patch WS sent
  → reload config attempt
    → success: toastSuccess('Settings saved')          [existing, no change]
    → WS closed error: beginRestart() + toastLoading('Gateway restarting…', undefined, { duration: Infinity })
                       store returned toastId in restartState or a module-level variable

onRestartReconnected() (called from gateway.svelte.ts onHelloOk)
  → dismiss the stored restartToastId
  → toastSuccess('Gateway reconnected — changes applied')
  → schedule resetRestartState() after 0ms (immediate)

timeout fires (30s, restartState.phase === 'failed')
  → dismiss the stored restartToastId
  → toastError('Gateway didn't reconnect', 'Try reconnecting manually')
  → optionally: add a Retry action if zag-js/toast supports action slots
```

The `toaster.dismiss(id)` API handles dismissal. Store the toast ID in `config.svelte.ts`:

```typescript
let _restartToastId: string | null = null;

export function beginRestart() {
  _clearRestartTimers();
  Object.assign(restartState, applyBeginRestart(restartState, Date.now()));
  _restartToastId = toaster.create({ title: 'Gateway restarting…', type: 'loading', duration: Infinity }).id;
  _restartTimeoutId = setTimeout(() => {
    if (restartState.phase === 'restarting') {
      restartState.phase = 'failed';
      if (_restartToastId) { toaster.dismiss(_restartToastId); _restartToastId = null; }
      toastError("Gateway didn't reconnect", 'Try reconnecting manually');
    }
  }, RESTART_TIMEOUT_MS);
}
```

**ConfigSaveBar role after migration:** The save bar persists for normal dirty state (dirty count, Save/Discard buttons). It only loses its restart-phase rendering. The `{#if restartState.phase !== 'idle'}` branches in ConfigSaveBar can be removed.

### New: NavigationGuardModal Component

Replace the single `confirm()` call in `beforeNavigate` with a custom modal. The modal is a simple Svelte component with `$state` for visibility, rendered at the settings page level (or in `+layout.svelte` if needed elsewhere — but for Phase 1, settings-page-only is sufficient).

```svelte
<!-- NavigationGuardModal.svelte -->
<script lang="ts">
  let { open = $bindable(false), onsave, ondiscard, oncancel }: {
    open: boolean;
    onsave: () => void;
    ondiscard: () => void;
    oncancel: () => void;
  } = $props();
</script>

{#if open}
  <!-- Overlay + modal box -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div class="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
      <h2 class="text-sm font-semibold text-foreground mb-2">Unsaved changes</h2>
      <p class="text-xs text-muted-foreground mb-6">
        You have unsaved changes. What would you like to do?
      </p>
      <div class="flex gap-2 justify-end">
        <button onclick={oncancel} class="...">Cancel</button>
        <button onclick={ondiscard} class="...">Discard</button>
        <button onclick={onsave} class="... bg-accent text-white">Save & Leave</button>
      </div>
    </div>
  </div>
{/if}
```

`beforeNavigate` wires this by setting `open = true` and calling `cancel()` immediately; the modal's `onsave` / `ondiscard` callbacks then do `save().then(() => goto(to))` or `discard(); goto(to)`.

### New: Disconnect-with-Dirty Warning Banner

When `conn.connected` drops to `false` while `isDirty.value` is `true`, show an inline warning banner inside the active gateway config tab panel (not a toast — needs to be persistent and obvious). The banner also queues an auto-save.

```typescript
// In settings page $effect
let pendingAutoSave = $state(false);

$effect(() => {
  if (!conn.connected && isDirty.value) {
    pendingAutoSave = true;
  }
  if (conn.connected && pendingAutoSave) {
    pendingAutoSave = false;
    save(); // auto-save on reconnect
  }
});
```

The warning banner shows when `!conn.connected && isDirty.value` and renders inside the visible gateway tab panel div (above the config sections). It should use the existing warning/amber theme tokens.

### Recommended Project Structure (no changes to directory layout needed)

```
src/
├── lib/
│   ├── components/
│   │   ├── config/
│   │   │   ├── ConfigSaveBar.svelte          # Remove restart phases; keep dirty-state UI
│   │   │   └── NavigationGuardModal.svelte   # NEW — custom confirm modal
│   │   └── settings/
│   │       └── SettingsTabBar.svelte         # Add dirtyTabIds prop + dot rendering
│   ├── state/
│   │   └── config/
│   │       └── config.svelte.ts              # Migrate restart UI to toast
│   └── utils/
│       └── config-schema.ts                  # Remove channels from TABS + TAB_MAPPING
└── routes/
    └── settings/
        └── +page.svelte                      # Main restructure: tab order, Comms+Channels merge, dirtyTabIds, modal, disconnect banner
```

### Anti-Patterns to Avoid

- **Calling `goto()` inside `beforeNavigate` synchronously.** `beforeNavigate` callback should either call `cancel()` to block or do nothing. Navigation to the new destination must happen via the modal's discard/save callbacks, not inside `beforeNavigate` itself.
- **Re-mounting DOM on tab switch.** Using `{#if}` instead of `visibility:hidden` destroys scroll position and triggers teardown/setup of IntersectionObserver. Stick to CSS visibility panels for all tabs.
- **Toaster ID leak.** Always store the restart toast ID and dismiss it before creating a new one in `beginRestart()`. Double-calling `beginRestart()` without cleanup produces orphaned loading toasts.
- **Checking `restartState.phase` in SettingsTabBar.** Tab bar should only know about `dirtyTabIds` — no restart state coupling.
- **Using native browser `confirm()` for any new UX in this phase.** The locked decision replaces ALL native confirm dialogs in the navigation guard path. The existing `window.confirm` in `loadConfig()` for stashed dirty changes (a different flow) can be addressed in Phase 2.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persistent / dismissible toasts | Custom toast manager | `toaster` from `$lib/state/ui/toast.svelte` | Already installed, zag-js handles stacking, dismiss, duration |
| Modal overlay | DIY portal/backdrop | Simple Svelte component with `fixed inset-0 z-50` | No portal needed for a single modal; Svelte renders in the right place |
| IntersectionObserver scrollspy | Custom scroll handler | `SettingsScrollspy.svelte` — already exists, already wired | IntersectionObserver edge cases (root margin, cross-tab visibility) are handled |
| Dirty path computation | Custom deep-compare | `computeDirtyPaths` in `config-schema.ts` | Already correct, already tested |
| Config state machine | Custom boolean flags | `config-restart.ts` pure functions | Already unit tested; extending them is straightforward |

**Key insight:** Every sub-problem in this phase already has an existing solution in the codebase. The work is wiring and restructuring, not building new primitives.

---

## Common Pitfalls

### Pitfall 1: SettingsTabBar / config-schema.ts tabs out of sync

**What goes wrong:** `TABS` in `config-schema.ts` is used for gateway config routing. `ALL_TABS` in `SettingsTabBar.svelte` is the visual definition. They must agree on which IDs exist. Removing `channels` from one but not the other causes the panel to appear but receive no tab button, or vice versa.

**How to avoid:** Update both in the same commit. The settings page `HUB_TAB_IDS` set (`const HUB_TAB_IDS = new Set([...])`) must also be updated to remove `'channels'` and reflect the new Comms tab absorbing it.

**Warning signs:** Tab renders with `visibility: hidden` but button doesn't appear, or console logs `undefined` group routes.

### Pitfall 2: `toaster.create()` return value shape

**What goes wrong:** Assuming `toaster.create()` returns `{ id: string }` — need to verify the actual zag-js toast API. If the return is the store or void, the dismiss pattern breaks.

**How to avoid:** The actual create return in zag-js/toast is an `id` string or an object with `id`. Check `@zag-js/toast` type definitions before storing. Alternatively, generate the ID externally: `const id = crypto.randomUUID(); toaster.create({ id, ... }); toaster.dismiss(id)`.

**Confidence:** MEDIUM — verified zag-js is used but exact `create()` return type not confirmed from types file. Plan should instruct implementer to check types first.

### Pitfall 3: `beforeNavigate` async timing

**What goes wrong:** The modal needs to show before navigation completes. If `cancel()` is called correctly but the modal state change is not reactive in time, the navigation still proceeds.

**How to avoid:** Call `cancel()` synchronously inside `beforeNavigate`. The modal `open` state flip is synchronous Svelte `$state` — it will trigger before the next frame. The user action (Save/Discard/Cancel) then programmatically triggers `goto()`.

### Pitfall 4: Disconnect auto-save firing on initial load

**What goes wrong:** The `$effect` watching `conn.connected && pendingAutoSave` fires on initial mount when `conn.connected` is already `true` and `pendingAutoSave` is `false`. No issue there. But if the effect re-runs due to unrelated reactive deps, it could clear `pendingAutoSave` prematurely.

**How to avoid:** Guard with `if (conn.connected && pendingAutoSave)` — only auto-save when the flag was explicitly set by the disconnect handler. Reset `pendingAutoSave` to `false` after triggering save, before the await.

### Pitfall 5: Channels in Comms — gw event subscriptions still work

**What goes wrong:** `ChannelsTab.svelte` uses `gw.channels?.channelAccounts` from gateway events and fetches from `$lib/state/channels`. Moving it into the Comms panel (which is only visible when that tab is active) does not break subscriptions — events update state regardless of panel visibility. There is no issue here if using CSS visibility panels.

**How to avoid:** Use CSS visibility (keep DOM mounted), not `{#if}`. The `ChannelsTab` should not teardown/reinitialize just because the tab is not visible.

---

## Code Examples

### Dirty Tab Dot in SettingsTabBar

```svelte
<!-- In SettingsTabBar.svelte - add dirtyTabIds prop -->
let { activeTab, onselect, dirtyTabIds = new Set<string>() }: {
  activeTab: string;
  onselect: (id: string) => void;
  dirtyTabIds?: Set<string>;
} = $props();

<!-- In the tab button template, after the label span -->
{#if dirtyTabIds.has(tab.id) && !isActive}
  <span
    class="absolute top-1.5 right-1 w-1.5 h-1.5 rounded-full bg-accent"
    aria-hidden="true"
  ></span>
{/if}
```

### NavigationGuardModal Integration in Settings Page

```svelte
<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import NavigationGuardModal from '$lib/components/config/NavigationGuardModal.svelte';

  let guardModalOpen = $state(false);
  let pendingNavigation: (() => void) | null = null;

  beforeNavigate(({ cancel, to }) => {
    if (isDirty.value) {
      cancel();
      pendingNavigation = to ? () => goto(to.url.pathname + to.url.search) : null;
      guardModalOpen = true;
    }
  });

  async function handleGuardSave() {
    guardModalOpen = false;
    await save();
    pendingNavigation?.();
    pendingNavigation = null;
  }

  function handleGuardDiscard() {
    discard();
    guardModalOpen = false;
    pendingNavigation?.();
    pendingNavigation = null;
  }

  function handleGuardCancel() {
    guardModalOpen = false;
    pendingNavigation = null;
  }
</script>

<NavigationGuardModal
  bind:open={guardModalOpen}
  onsave={handleGuardSave}
  ondiscard={handleGuardDiscard}
  oncancel={handleGuardCancel}
/>
```

### Restart Toast with Dismiss

```typescript
// In config.svelte.ts
import { toaster, toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

let _restartToastId: string | null = null;

export function beginRestart() {
  _clearRestartTimers();
  Object.assign(restartState, applyBeginRestart(restartState, Date.now()));

  // Dismiss any previous restart toast before creating a new one
  if (_restartToastId) { toaster.dismiss(_restartToastId); }
  _restartToastId = toaster.create({
    title: 'Gateway restarting…',
    type: 'loading',
    duration: Infinity,
  });

  _restartTimeoutId = setTimeout(() => {
    if (restartState.phase === 'restarting') {
      restartState.phase = 'failed';
      if (_restartToastId) { toaster.dismiss(_restartToastId); _restartToastId = null; }
      toastError("Gateway didn't reconnect", 'Try reconnecting manually');
    }
  }, RESTART_TIMEOUT_MS);
}

export function onRestartReconnected() {
  _clearRestartTimers();
  if (_restartToastId) { toaster.dismiss(_restartToastId); _restartToastId = null; }
  const dirty = _isDirty;
  Object.assign(restartState, applyReconnected(restartState, dirty));
  if (dirty) {
    toastWarning('Gateway reconnected', 'You had unsaved local changes that were preserved');
  } else {
    toastSuccess('Gateway reconnected — changes applied');
  }
  _dismissTimeoutId = setTimeout(() => {
    if (restartState.phase === 'reconnected') resetRestartState();
  }, RECONNECTED_DISMISS_MS);
}
```

### Disconnect Banner in Settings Page

```svelte
<!-- Inside each gateway config tab panel, before ConfigSection list -->
{#if !conn.connected && isDirty.value}
  <div class="mx-6 mt-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-center gap-3">
    <span class="text-amber-400 text-xs font-medium">Disconnected</span>
    <span class="text-muted-foreground text-xs flex-1">
      Changes will be saved automatically when reconnected.
    </span>
  </div>
{/if}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Native `confirm()` modal | Custom themed modal (Phase 1 change) | App-consistent UX; supports Save/Discard/Cancel three-way choice |
| ConfigSaveBar restart phases (inline) | Persistent toast (Phase 1 change) | Restart indicator is non-blocking; save bar simplifies to dirty-only concern |
| Default tab: `appearance` | Default tab: `hosts` (Phase 1 change) | First thing admin sees is gateway connections, not appearance settings |
| 9 tabs (Channels separate) | 8 tabs (Channels inside Comms) | Reduces tab bar crowding; Channels is naturally a comms concern |

**Deprecated/outdated:**
- The `restartState.phase !== 'idle'` conditional in `ConfigSaveBar` template is removed in Phase 1. The save bar becomes a simple dirty-count bar.

---

## Open Questions

1. **`toaster.create()` return type**
   - What we know: zag-js/toast is installed; `toaster` is the store created by `createStore()`
   - What's unclear: whether `create()` returns an ID string, an object with `.id`, or void
   - Recommendation: Implementer checks `node_modules/@zag-js/toast/dist/index.d.ts` before writing dismiss logic. Alternative: use a pre-generated `crypto.randomUUID()` as the toast ID.

2. **`beforeNavigate` `to` field for modal redirect**
   - What we know: SvelteKit `beforeNavigate` receives `{ to, from, cancel, ... }`. `to` has `.url`.
   - What's unclear: Whether `to` can be null for certain navigation types (e.g., back button)
   - Recommendation: Guard `pendingNavigation` assignment: `if (to) { pendingNavigation = () => goto(to.url.href); }`. If `to` is null, just discard and do nothing.

3. **Channels auto-save during reconnect conflict with window.confirm for stash**
   - What we know: `loadConfig()` in `config.svelte.ts` has a `window.confirm` for stashed dirty changes during restart. The new auto-save on reconnect would arrive around the same time.
   - What's unclear: Does auto-save race with the config reload in `onHelloOk`?
   - Recommendation: The auto-save on reconnect (`PLSH-03`) should only trigger for the disconnect-while-dirty case (not a restart-triggered disconnect). Add a guard: only auto-save if `restartState.phase === 'idle'` at reconnect time.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `bun run vitest run src/lib/state/config/config-restart.test.ts` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTG-02 / PLSH-01 | Restart state machine: idle→restarting→reconnected/failed transitions | unit | `bun run vitest run src/lib/state/config/config-restart.test.ts` | ✅ exists |
| INTG-02 / PLSH-01 | `beginRestart` sets `phase = 'restarting'`, timeout → `'failed'` | unit | `bun run vitest run src/lib/state/config/config-restart.test.ts` | ✅ exists |
| LAYOUT-01 | Tab order constant matches spec (8 tabs, correct order) | unit | `bun run vitest run src/lib/utils/config-schema.test.ts` | ❌ Wave 0 |
| LAYOUT-01 | `getGroupsForTab('comms', ...)` includes channels groups | unit | `bun run vitest run src/lib/utils/config-schema.test.ts` | ❌ Wave 0 |
| SAVE-02 / SAVE-03 | `computeDirtyPaths` (drives dirty count in save bar) | unit | `bun run vitest run src/lib/utils/config-schema.test.ts` | ❌ Wave 0 |
| PLSH-03 | Auto-save on reconnect only when `restartState.phase === 'idle'` | manual smoke | Navigate to settings → disconnect → make change → reconnect → verify save | manual-only (component behavior) |

**Note:** UI/component behavior (tab visibility switching, modal open/close, navigation guard, toast appearance) is manual-only — no Svelte component test infrastructure exists in this project.

### Sampling Rate
- **Per task commit:** `bun run vitest run src/lib/state/config/config-restart.test.ts`
- **Per wave merge:** `bun run test`
- **Phase gate:** `bun run test` + `bun run check` (svelte-check) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/utils/config-schema.test.ts` — covers LAYOUT-01 (tab count/order assertions) and SAVE-02 (dirty path computation edge cases). The existing `config-schema.ts` exports are pure functions — no mocking needed.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase reading: `src/routes/settings/+page.svelte` (443 lines) — full tab implementation
- Direct codebase reading: `src/lib/state/config/config.svelte.ts` — save/restart logic
- Direct codebase reading: `src/lib/state/config/config-restart.ts` — state machine
- Direct codebase reading: `src/lib/components/config/ConfigSaveBar.svelte` — current restart UI
- Direct codebase reading: `src/lib/components/settings/SettingsTabBar.svelte` — tab bar
- Direct codebase reading: `src/lib/utils/config-schema.ts` — TABS, TAB_MAPPING, group routing
- Direct codebase reading: `src/lib/state/ui/toast.svelte.ts` — toast API
- Direct codebase reading: `src/lib/services/gateway.svelte.ts` (line 586-624) — `onHelloOk` restart wiring
- Direct codebase reading: `src/lib/state/config/config.test.ts` — existing test patterns
- Direct codebase reading: `.planning/codebase/TESTING.md`, `STACK.md`, `CONVENTIONS.md`

### Secondary (MEDIUM confidence)
- `.planning/PROJECT.md` — project goals and constraints cross-validated

### Tertiary (LOW confidence)
- None — all findings are from direct code inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed and in use
- Architecture: HIGH — patterns are read directly from existing implementation
- Pitfalls: HIGH — identified from actual code patterns (existing `confirm()`, tab sync gap, toaster API uncertainty is flagged LOW)
- Toast dismiss API: MEDIUM — usage is confirmed; exact return type of `create()` flagged for implementer verification

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable stack; only expires if zag-js/toast API changes)
