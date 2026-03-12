# Phase 1: Tab Layout and Save Infrastructure - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the settings page sidebar with tabbed navigation, harden save/restart UX with toast-based feedback, and ensure no state loss during tab switches or gateway reconnection. This phase establishes the foundation for all subsequent settings phases (cards, search, wizard).

Note: Much of the tab infrastructure already exists (SettingsTabBar, CSS visibility panels, navigation guards, skeleton, scrollspy, restart state machine, save bar). This phase refines and hardens what's there.

</domain>

<decisions>
## Implementation Decisions

### Tab reorganization
- Merge Channels tab into Comms tab, reducing from 9 to 8 tabs
- Tab order: Hosts → AI → Agents → Comms → Security → System → Backups → Appearance
- Default landing tab changes from Appearance to Hosts (`?s=hosts`)
- Channels content placement within Comms tab: Claude's discretion (separate card below vs integrated — based on current ChannelsTab component structure)

### Restart recovery UX
- Save bar dismisses after save; restart progress tracked via persistent toast ("Gateway restarting...")
- On reconnect: auto-verify by re-fetching config and comparing with expected state, then show success/warning toast. Auto-dismiss after 3s.
- On timeout (30s): error toast "Gateway didn't reconnect" with a Retry action button
- Fields during restart: Claude's discretion (keep editable vs disable)

### Save confirmation
- Non-restart saves: success toast "Settings saved", auto-dismiss after 2-3s
- Save bar shows dirty count only ("3 unsaved changes") — no field list. Detailed diff preview deferred to Phase 3.
- Ctrl/Cmd+S triggers same toast confirmation as clicking Save button

### Scroll & state preservation
- Per-tab scroll position remembered — switching back restores where you were (already mostly free with visibility:hidden DOM mounting)
- Tab mounting strategy: Claude's discretion (keep all mounted vs lazy mount)
- Expanded/collapsed group state persists in session only — resets on page refresh
- On disconnect with unsaved changes: preserve edits + warning banner "Disconnected — changes will save on reconnect". Auto-save when reconnected.

### Loading states
- Host switch (different gateway): re-fetch with skeleton loader, clear previous config state completely

### Save bar position
- Claude's discretion (sticky bottom vs floating bottom-right — pick what works best with tab layout)

### Tab badge indicators
- Dirty dot only — small colored dot on tabs containing unsaved changes
- No error/validation badges in Phase 1 (deferred to Phase 3)

### Navigation guard
- Custom styled modal replacing native confirm() dialog
- Modal should have Save / Discard / Cancel buttons, matching app theme

### Claude's Discretion
- Channels placement within Comms tab (separate card or integrated sections)
- Fields editable vs disabled during restart window
- Tab mounting strategy (all mounted vs lazy mount on first visit)
- Save bar position (sticky bottom vs floating)
- Loading skeleton design
- Exact spacing and typography

</decisions>

<specifics>
## Specific Ideas

- Toast-based feedback for all save/restart flows rather than inline save bar state changes
- Custom navigation guard modal should feel like a native part of the app, not a browser dialog
- Dirty dots on tabs should be subtle — accent-colored, small, positioned near tab label

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SettingsTabBar.svelte`: Already renders tabs with Lucide icons and active underline — needs tab count/order update and dirty dot addition
- `SettingsSkeleton.svelte`: Loading skeleton for config tabs — reusable as-is
- `SettingsScrollspy.svelte`: IntersectionObserver-based scrollspy with dirty group indicators — already wired up
- `ConfigSaveBar.svelte`: Save bar with restart state handling — needs toast migration
- `config-restart.ts`: Pure restart state machine (idle→restarting→reconnected→failed) — keep and enhance
- `config.svelte.ts`: Config state module with loading, dirty tracking, patch computation — core foundation
- `ChannelsTab.svelte`: Standalone channels management component — will be moved into Comms tab
- Toast system: `toastError`, `toastSuccess`, `toastInfo` from `$lib/state/ui/toast.svelte`

### Established Patterns
- CSS visibility panels: `style:visibility` + `style:z-index` for tab switching without unmounting DOM
- URL-persisted tab: `page.url.searchParams.get("s")` with `goto('?s=id', { replaceState: true })`
- Navigation guards: `beforeNavigate` + `beforeunload` event listeners in `onMount`
- State modules: `$state()` runes in `.svelte.ts` files with exported getter objects

### Integration Points
- Settings page: `src/routes/settings/+page.svelte` (443 lines) — main file to restructure
- Gateway connection: `conn.connected` from `$lib/state/gateway/connection.svelte` gates config loading
- Config schema: `TABS` and `getGroupsForTab` from `$lib/utils/config-schema.ts` define tab→group mapping
- Hub-managed tabs: Hosts, Backups, Appearance render their own components; gateway tabs render ConfigSection groups

</code_context>

<deferred>
## Deferred Ideas

- Validation error badges on tabs — Phase 3 (Discovery and Overrides)
- Config diff preview before saving — Phase 3
- Per-field dirty indicators — Phase 2 (Cards and Field Widgets)
- Card-based grouping — Phase 2

</deferred>

---

*Phase: 01-tab-layout-and-save-infrastructure*
*Context gathered: 2026-03-11*
