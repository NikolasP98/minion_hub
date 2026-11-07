---
status: implementing
verdict: approved
---

# Personal navigation and complete section discovery

Owner authorization: 2026-11-06 request explicitly asks to deploy the navigation changes. Settings is design review only.

## Cross-check

- Meta proposal `2026-10-28-hub-org-module-packages-tenancy-nav-home`, specs 037 and 046, Hub PRs #602 (section access), #626 (name-only sections), #628 (landing-page Home), #630 (module provisioning).
- Meta proposal `2026-09-13-hub-module-switcher-followups`: browser-scoped mode and mobile coverage.
- Shared Hub working checkout has extensive unrelated changes. Candidate starts at origin/master e169762d in a separate clone; no existing worktrees or branches changed.
- `/account/home` is a personal section catalog; it does not rename `/home`, alter `/` redirects, merge pending PRs, or implement the Settings workshop.

## AS-IS

`custom-sections-nav.ts:usable` drops empty custom sections; `modules.ts:visibleModules` also drops empty modules. `ModuleSwitcher` offers full navigation to every user. `navMode` trusts browser-global `full` and defaults unknown roles to full. Shared organization navigation is editable only by its existing manage capability; individual sidebar order already persists through personal preferences.

## TO-BE and invariants

1. The picker and `/account/home` list every permitted section, including empty custom sections and built-in modules emptied through organization customization. Sections with only denied pages remain absent. Module feature/kind and route RBAC still apply. Empty sections open `/account/home?section=<module-id>` and show a localized empty state.
2. “Todas las secciones” is available only to platform admins or organization owner/admin/manager roles. Unknown roles fail closed; stale localStorage `full` cannot restore it for staff. This changes navigation presentation; existing route/data permissions remain authoritative.
3. Every user has “Mi inicio” at `/account/home`, listing all permitted sections, with own hide/show and keyboard-accessible up/down ordering for the personal sidebar. Organization configuration is untouched. A versioned personal preference is keyed by profile and the organization-qualified preference section and contains its organization id; mismatched organizations ignore it and writes reject a changed organization. New catalog entries append; stale entries cannot grant access.
4. Mobile uses the same section catalog and offers Mi inicio. Settings UI, routes and module are unchanged until workshop approval.

## DELTA and proof

- Preserve permitted empty sections in the server navigation projection; emit section grants from current RBAC decisions, without implying page rights.
- Preserve empty sections through custom module derivation and permission-filtered visibleModules; safe empty-state href and query-aware selection.
- Gate full mode at its state owner and dropdown; add personal mode, personal sidebar and home entry on desktop/mobile.
- Add `/account/home`, explicit authenticated route policy, localized strings, versioned preference validation and scope-aware autosave feedback.
- Tests: empty/permitted/denied custom sections; all-denied modules; full-mode owner/admin/manager/staff/unknown and stale preference; preference validation/org scope; catalog reconciliation; actual desktop/mobile browser interaction and persistence.
- Run check, tests, build, design/token gates; review Standards and Spec separately; qualify CI and deployed revision.

## Design-only Settings deliverable

Existing `.local/figcraft/minion-hub.figcraft`, new page “Settings · AS-IS → TO-BE · 2026-11-06”, copied Settings Appearance/Plugins views and POS entry view. Avatar → Settings, full settings sidebar, Back to the previous module; existing permission-filtered groups remain the implementation authority. No Settings production changes.

## Independent review

Two-pass spec review and implementation review completed by navigation_review. Corrections applied: separate organization-qualified preference rows; module availability snapshot; genuinely empty versus denied-only sections; personal home nested under /account/home to preserve pre-existing custom-section slugs; layout reset bypasses AccountNav; Review latest fences owner, editor token and edit revision before retiring its draft. No remaining source-level blockers. Reviewer tests: 16 navigation mode tests plus 93 adjacent tests passed.

## Verification in progress

Focused source tests passed; check reports 0 errors and 0 warnings. Full test/build and actual local QA browser paths remain in progress. This is a draft delivery state, not a deployment claim.
