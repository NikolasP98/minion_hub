import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows } from '$server/db/schema';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getUserPreferences, upsertUserPreference } from '$server/services/user-preferences.service';

// Auto-install plugin-shipped flows. The browser fetches enabled plugins'
// templates from the gateway (flows.templates.list) and POSTs them here; we
// create a flow row for any template this user hasn't installed yet.
//
// Install state is tracked in user_preferences (section "pluginFlowInstalls")
// rather than on the flow row, so the install is recorded permanently: if the
// user later deletes the installed flow, we do NOT resurrect it on the next
// visit. Installed flows are created INACTIVE — the user reviews and activates
// them (which registers the channel trigger) deliberately.

const PREF_SECTION = 'pluginFlowInstalls';

type IncomingTemplate = {
  pluginId?: string;
  id?: string;
  name?: string;
  description?: string;
  nodes?: unknown;
  edges?: unknown;
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const body = (await request.json()) as { templates?: IncomingTemplate[] };
  const templates = Array.isArray(body.templates) ? body.templates : [];

  const prefs = await getUserPreferences(ctx.db, user.id);
  const recorded = prefs[PREF_SECTION] as { keys?: string[] } | undefined;
  const installedKeys = new Set<string>(Array.isArray(recorded?.keys) ? recorded.keys : []);

  const newlyInstalled: Array<{ key: string; id: string; name: string }> = [];
  const now = Date.now();

  for (const t of templates) {
    if (!t.pluginId || !t.id || !t.name) continue;
    const key = `${t.pluginId}:${t.id}`;
    if (installedKeys.has(key)) continue;

    const id = randomUUID();
    await ctx.db.insert(flows).values({
      id,
      name: t.name,
      nodes: Array.isArray(t.nodes) ? JSON.stringify(t.nodes) : '[]',
      edges: Array.isArray(t.edges) ? JSON.stringify(t.edges) : '[]',
      userId: user.id,
      tenantId: ctx.tenantId,
      createdAt: now,
      updatedAt: now,
      active: false,
    });
    installedKeys.add(key);
    newlyInstalled.push({ key, id, name: t.name });
  }

  if (newlyInstalled.length > 0) {
    await upsertUserPreference(ctx.db, user.id, PREF_SECTION, { keys: [...installedKeys] });
  }

  return json({ installed: newlyInstalled, count: newlyInstalled.length });
};
