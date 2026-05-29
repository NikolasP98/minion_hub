# Plugin Flow Groups — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Primary repo:** `minion_hub` · **Also touches:** `minion` (gateway), `@minion-stack/shared`

## Problem

Today a flows-contributing plugin (e.g. `alert-watcher`) auto-installs **one flow row per
template** into a flat list. Those rows are **non-deletable** (hard 403 + Lock icon) because a
delete would just be resurrected on the next sync, and deleting orphans the install record.
Origin is stored on the flow row as `config.source = { pluginId, templateId }`.

Consequences:

- The flow list is a flat grid with no notion of "these belong to plugin X".
- Plugin flows can never be removed, even after the user has finished with one.
- There is no first-class container to attach plugin lifecycle (enabled / disabled / uninstalled)
  state to.

## Goal

Invert the model: a plugin owns a **non-deletable group container**; inside it the user freely
creates and deletes **editable duplicates of the plugin's templates**. Groups are first-class and
also user-creatable for organizing personal flows.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Template instantiation | **Duplicate & edit freely** — instantiating copies the template's nodes/edges into a new, fully-editable flow inside the group. No manifest param-schema; "parameters and values" = whatever the user edits in the canvas. |
| Group kinds | **Plugin groups + user-created groups**, plus a default ungrouped **"My Flows"** bucket. |
| On plugin-enable | **Seed one instance per template** into the group (deletion-safe), matching today's out-of-the-box behavior — but now grouped and deletable. |
| On plugin-uninstall | **Release to user** — group converts to a normal user group (`pluginId` cleared), flows preserved. Non-destructive. |
| Existing prod flows | **Migrate** — a one-time reconcile sweep wraps already-installed plugin flows into their plugin's group. |

## Data model

### New table `flow_groups`

```
id         text  PK
name       text  notNull
userId     text             -- owner; null = legacy/shared
tenantId   text             -- tenant scope
pluginId   text             -- set ⇒ plugin-owned (locked); null ⇒ user group
disabled   integer(bool)    -- true ⇒ owning plugin is disabled (dimmed); always false for user groups
createdAt  integer  notNull
updatedAt  integer  notNull
```

Index: `flow_groups_owner_idx` on `(userId, tenantId)`.

### `flows` table change

Add nullable column:

```
group_id   text             -- FK→flow_groups.id; null ⇒ "My Flows" (ungrouped)
```

`config.source.{pluginId,templateId}` is retained per-instance so a duplicated flow remembers which
template it came from (used for the per-card origin pill; not used for locking anymore).

### Migration (prod Turso — hand-managed schema)

**Never `drizzle-kit push`.** Apply via the established surgical pattern (idempotent libsql):

1. `CREATE TABLE IF NOT EXISTS flow_groups (...)`
2. `ALTER TABLE flows ADD COLUMN group_id TEXT` (guard against "duplicate column" by catching the error / checking pragma).

Then the first `reconcile` call (below) performs the one-time sweep of existing plugin flows into
their groups.

## Lifecycle / reconciliation

Replaces `/api/flows/sync`. The browser collects the gateway's flow-contributing plugins
(`flows.templates.list`, see Gateway change) and POSTs them to `POST /api/flows/reconcile`. The
server, per `(userId, tenantId)`:

1. **Ensure group per flow-contributing plugin.** For each plugin `P`: find a group with
   `pluginId = P.id`; if none, create it (`name = P.displayName`, `pluginId = P.id`). Set
   `disabled = !P.enabled` on the group.
2. **Sweep existing plugin flows (migration).** Any flow with `flowSourceFrom(config).pluginId === P.id`
   and `group_id IS NULL` → set `group_id = group.id`.
3. **Seed instances.** For each template `T` in an **enabled** `P`: key `${P.id}:${T.id}`. If the key
   is not in `user_preferences.pluginFlowInstalls.keys`, create one editable instance flow
   (`group_id = group.id`, `config.source = {pluginId, templateId}`, `active: false`,
   nodes/edges copied from the template) and record the key. (Deletion-safe: deleting an instance
   never resurrects it.)
4. **Uninstall = release.** Any existing group with a non-null `pluginId` whose `pluginId` is **not**
   in the current flow-contributing plugin set → set `pluginId = null`, `disabled = false`
   (converts to a user group; flows preserved).

`reconcile` is idempotent and safe to call on every landing-page mount.

## Deletability rules

- **Instance flows:** deletable. Remove the plugin-origin 403 guard in `DELETE /api/flows/[id]`.
  (Ownership/tenant checks stay.) The landing UI shows a working trash on every card.
- **Plugin group** (`pluginId` set): **not** deletable. `DELETE /api/flow-groups/[id]` → 403.
- **User group** (`pluginId` null): deletable. On delete, its flows move to "My Flows"
  (`group_id = null`) — flows are **not** destroyed.
- **Disabled plugin** (`group.disabled === true`): group + its cards render **dimmed**; the
  "+ New from template" action is disabled; instances cannot be activated. (Editor-level gating via
  `shouldBlockFlowEditor` is unchanged.)

## UI — `/flow-editor` flows view becomes grouped

Collapsible sections, ordered **My Flows → user groups → plugin groups**.

- **My Flows** (ungrouped): header + `[+]` (new blank flow). Cards deletable.
- **User group**: header (name) + `[+]` (new blank flow in group) + `[⋯]` (rename / delete group).
- **Plugin group**: 🧩 + plugin name + **`[+ New from template ▾]`** dropdown (lists the plugin's
  templates → duplicates the chosen template into the group) + a Lock affordance (non-deletable).
  When `disabled`: whole section dimmed (opacity + muted), the "+ New from template" control
  disabled, and a small "disabled" chip on the header.

### New / changed components

| File | Change |
|---|---|
| `src/lib/components/flow-editor/FlowGroupSection.svelte` | **New** — renders a group header (with kind-specific actions) + its flow cards. |
| `src/lib/components/flow-editor/NewFromTemplateMenu.svelte` | **New** — dropdown of a plugin's templates; on pick, POSTs a duplicate. |
| `src/routes/(app)/flow-editor/+page.svelte` | Refactor flows view from flat grid → iterate `groups`; move card markup into `FlowGroupSection`. |

### New / changed API

| Route | Methods |
|---|---|
| `src/routes/api/flow-groups/+server.ts` | **New** — `GET` (list groups for user/tenant, each with `pluginId`, `disabled`), `POST` (create user group `{name}`). |
| `src/routes/api/flow-groups/[id]/+server.ts` | **New** — `PATCH` (rename; user groups only), `DELETE` (user groups only → 403 for plugin groups; reassigns flows to ungrouped). |
| `src/routes/api/flows/reconcile/+server.ts` | **New** (replaces `sync/`) — group reconciliation per the lifecycle above. |
| `src/routes/api/flows/+server.ts` | `GET` returns `groupId`; `POST` accepts optional `groupId` + `templateId` (duplicate path). |
| `src/routes/api/flows/[id]/+server.ts` | `DELETE` — drop the plugin-origin 403 (instances deletable). `GET` returns `groupId`. |

### New helper

`src/lib/flows/groups.ts` — pure helpers: group ordering, `isPluginGroup`, kind classification
(mirrors `plugin-source.ts` style; unit-tested).

## Gateway change (`minion`)

Extend the existing `flows.templates.list` RPC result to additionally return a `plugins` grouping
that includes **disabled** flow-contributing plugins and a display name:

```ts
{
  templates: FlowTemplate[];           // unchanged — back-compat (enabled plugins only)
  plugins: Array<{
    pluginId: string;
    displayName: string;
    enabled: boolean;                  // configEnabled
    templates: FlowTemplate[];
  }>;
}
```

`enabled` + presence in `plugins[]` is what drives hub group create / dim / uninstall-detection.
The hub falls back gracefully (no `plugins` field ⇒ derive a single-plugin grouping from the flat
`templates`, all `enabled: true`) so a hub deploy doesn't hard-require the gateway deploy first.

## Shared types (`@minion-stack/shared`)

Add the `plugins` payload shape to the flows-templates RPC result type if one exists there; the hub
duplicates the type locally if the package is publish-only (per existing convention).

## Testing

- `flow-groups.test.ts` — group ordering + kind classification helpers.
- `reconcile.server.test.ts` — ensure-group, seed-once (deletion-safe), migration sweep, disable
  flag, uninstall-release. Mirrors `plugin-flows.server.test.ts`.
- `flow-groups.server.test.ts` — user-group create/rename/delete; plugin-group delete → 403;
  delete reassigns flows to ungrouped.
- Update `plugin-flows.server.test.ts` — instances are now deletable (the old 403 expectation flips).

## Non-goals / YAGNI

- No manifest-declared structured parameter schema or instantiation form (the "structured param
  form" option was explicitly declined — instances are full editable copies).
- No drag-and-drop reordering of groups or moving flows between groups (v1 orders by `createdAt`;
  flows are assigned at create/instantiate time). Can follow later.
- No cross-tenant / shared groups.

## Cross-project impact summary

| Repo | Work |
|---|---|
| `minion_hub` | Schema (1 table + 1 column), 3 API route groups, landing UI refactor + 2 new components, 1 helper, reconcile logic. **Primary.** |
| `minion` (gateway) | One `flows.templates.list` enhancement (add `plugins` grouping w/ enabled + displayName). Small. |
| `@minion-stack/shared` | RPC payload type addition (or local dup). Tiny. |
| `langgraph-server` | None. |
