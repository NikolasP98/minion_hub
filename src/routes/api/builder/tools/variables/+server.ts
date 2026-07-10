import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getFinSettings } from '$server/services/finance.service';
import { supabaseAdmin } from '$server/supabase';
import { MODULE_VARS } from '$server/services/hub-module-vars';

/** The 7 system vars the gateway injects at custom-tool run time (spec C9). */
const SYSTEM_VARS = [
  { key: 'MINION_AGENT_ID', description: 'The gateway agent id running this tool.' },
  { key: 'MINION_ORG_ID', description: "The tool owner's organization id." },
  { key: 'MINION_USER_ID', description: "The tool owner's profile id." },
  { key: 'MINION_GATEWAY_URL', description: 'Base URL of the gateway that ran this tool.' },
  { key: 'MINION_HUB_URL', description: 'Base URL of this hub instance.' },
  { key: 'MINION_TOOL_ID', description: 'This custom tool\'s id.' },
  { key: 'MINION_TOOL_NAME', description: 'This custom tool\'s name.' },
] as const;

/**
 * GET /api/builder/tools/variables — data for the editor's Env/System/Module/
 * Database variable tabs (spec C9). Gated on `tools.view` like the rest of
 * /api/builder/tools*.
 */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'tools', 'view');
  const ctx = await requireCoreCtx(locals);

  const [{ data: org }, finSettings] = await Promise.all([
    supabaseAdmin().from('organizations').select('name').eq('id', ctx.tenantId).maybeSingle(),
    getFinSettings(ctx),
  ]);

  const database = [
    {
      key: 'MINION_DB_ORG_NAME',
      value: (org as { name?: string } | null)?.name ?? '',
      description: "The organization's display name.",
    },
    { key: 'MINION_DB_CURRENCY', value: finSettings.currency, description: 'Display currency (fin_settings, defaults to PEN).' },
    // ponytail: no per-org timezone/locale column exists yet — static defaults
    // until an org-settings field lands (no migration warranted for two strings).
    { key: 'MINION_DB_TIMEZONE', value: 'America/Lima', description: "The org's default timezone." },
    { key: 'MINION_DB_LOCALE', value: 'es-PE', description: "The org's default locale." },
  ];

  return json({ system: SYSTEM_VARS, module: MODULE_VARS, database });
};
