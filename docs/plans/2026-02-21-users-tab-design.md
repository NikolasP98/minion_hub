# Users Tab — Design Doc

**Date:** 2026-02-21
**Status:** Approved

## Overview

Add a `/users` page to Minion Hub with two tabs:

- **Team** — manage hub users (DB-backed): roles, invite, remove
- **Bindings** — visual editor for the `bindings` array in the live gateway config

## Navigation

Add a "Users" pill link to `Topbar.svelte` alongside Reliability/Config/Settings.

## Page Shell

Same pattern as Settings/Config: full-height flex column, `← Back` link, centered title, tab switcher below header.

---

## Team Tab

### Data source
`GET /api/users` — returns users joined to the active tenant.

### Display
Table with columns: Email, Display name, Kind (operator/contact), Role, Joined, Actions.

### Interactions
- **Role change**: inline `<select>` per row → `PATCH /api/users/[id]` with `{ role }`
- **Remove**: button per row → `DELETE /api/users/[id]` (removes from tenant, does not delete user record)
- **Invite**: button at top-right opens inline form (email, password, display name, role) → `POST /api/users`

### New API endpoint
`src/routes/api/users/[id]/+server.ts`
- `PATCH` — update role (validates role enum: owner/admin/member/viewer)
- `DELETE` — remove user from tenant (deletes `userTenants` row, not `users` row)

### New service functions (`user.service.ts`)
- `updateUserRole(ctx, userId, role)` — updates `userTenants.role`
- `removeUserFromTenant(ctx, userId)` — deletes `userTenants` row

---

## Bindings Tab

### Data source
`configState.current?.bindings` — the live gateway config array, same source as the Config page. Requires gateway connection.

### Binding shape (from minion.json)
```json
{
  "agentId": "panik",
  "match": {
    "channel": "whatsapp",
    "peer": { "kind": "dm", "id": "+51922286663" }
  }
}
```

### Display
Cards grouped by `agentId`. Each row shows:
- Channel icon (WhatsApp / Telegram / Discord)
- Peer kind badge: DM or Group
- Peer ID string
- Remove (×) button

### Add binding
A form (per-group or global) with:
- Agent dropdown (from `gw.agents`)
- Channel select (whatsapp / telegram / discord)
- Peer kind (dm / group)
- Peer ID text input

### Save
Mutates `configState.current.bindings` directly, triggering the existing `isDirty` / save bar mechanic from the Config page.

### Empty state
If gateway is not connected: same "not connected" state as Config page.

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/components/Topbar.svelte` | Add Users nav link |
| `src/routes/users/+page.svelte` | New page |
| `src/lib/components/users/TeamTab.svelte` | New component |
| `src/lib/components/users/BindingsTab.svelte` | New component |
| `src/routes/api/users/[id]/+server.ts` | New API: PATCH + DELETE |
| `src/server/services/user.service.ts` | Add `updateUserRole`, `removeUserFromTenant` |
