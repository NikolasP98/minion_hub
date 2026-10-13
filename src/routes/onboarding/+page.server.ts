import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { supabaseAdmin } from '$server/supabase';
import { availableLanguageTags } from '$lib/paraglide/runtime';
import { nextOnboardingScope } from '$lib/onboarding/gate';
import { loadOrganizationsForUser } from '$server/services/organizations.service';
import { getFinSettings, updateFinSettings } from '$server/services/finance.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { updateSupabaseProfile } from '$server/services/supabase-credential';
import { upsertUserPreference } from '$server/services/user-preferences.service';
import { invalidateLandingCache } from '$server/landing-cache';

/** Timezones offered by the org flow. Narrow on purpose — anything else is set
 *  later in /finances settings, which accepts any IANA zone. */
const TIMEZONES = [
  'America/Lima',
  'America/Bogota',
  'America/Mexico_City',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/Madrid',
  'Europe/London',
  'Europe/Berlin',
] as const;

/** Currencies offered by the org flow (ISO 4217). Same reasoning as TIMEZONES. */
const CURRENCIES = ['PEN', 'USD', 'EUR', 'MXN', 'COP', 'CLP', 'ARS'] as const;

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth(locals);
  const organizations = await loadOrganizationsForUser(locals as App.Locals, user.id);
  const activeOrg =
    organizations.organizations.find((org) => org.id === organizations.activeOrgId) ?? null;
  if (!activeOrg) throw redirect(303, '/join');

  const scope = nextOnboardingScope({
    userOnboardedAt: user.onboardedAt ?? null,
    activeOrg,
  });
  // Nothing left to set up — the hook on "/" resolves the user's landing page.
  if (!scope) throw redirect(303, '/home');

  if (scope === 'org') {
    const ctx = await getCoreCtx(locals as App.Locals);
    const fin = ctx ? await getFinSettings(ctx) : null;
    return {
      scope,
      org: {
        name: activeOrg.name,
        kind: activeOrg.kind,
        timezone: fin?.timezone ?? TIMEZONES[0],
        currency: fin?.currency ?? CURRENCIES[0],
      },
      timezones: TIMEZONES,
      currencies: CURRENCIES,
    };
  }

  return {
    scope,
    user: { displayName: user.displayName ?? '', email: user.email ?? '' },
    languages: availableLanguageTags as readonly string[],
  };
};

/** Stamp the marker that retires a flow — also what "Skip" does. */
async function stampOrg(orgId: string, set: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin()
    .from('organizations')
    .update({ ...set, onboarded_at: new Date().toISOString() })
    .eq('id', orgId);
  if (error) throw new Error(error.message);
}

export const actions: Actions = {
  /** New-org setup: org kind + the business timezone/currency every finance and
   *  scheduling report reads. Re-renders into the user flow when one is due. */
  org: async ({ locals, request }) => {
    // Authoritative gate: the UI only offers this flow to owner/admin, but the
    // write itself is an org-config change like any /settings page.
    await requireOrgCapability(locals as App.Locals, 'settings', 'manage');
    const orgId = locals.tenantCtx?.tenantId;
    if (!orgId) throw redirect(303, '/join');

    const fd = await request.formData();
    if (fd.get('skip')) {
      await stampOrg(orgId);
      return;
    }

    const kind = String(fd.get('kind') ?? '');
    const timezone = String(fd.get('timezone') ?? '');
    const currency = String(fd.get('currency') ?? '');
    if (kind !== 'business' && kind !== 'personal') {
      return fail(400, { error: 'Pick how this organization is used.' });
    }
    if (!(TIMEZONES as readonly string[]).includes(timezone)) {
      return fail(400, { error: 'Pick a timezone.' });
    }
    if (!(CURRENCIES as readonly string[]).includes(currency)) {
      return fail(400, { error: 'Pick a currency.' });
    }

    const ctx = await getCoreCtx(locals as App.Locals);
    if (ctx) await updateFinSettings(ctx, { timezone, currency });
    await stampOrg(orgId, { kind });
    // No redirect: the re-run load decides whether the user flow follows.
  },

  /** New-user setup: display name + UI language, then into the app. */
  user: async ({ locals, request }) => {
    const user = requireAuth(locals);
    const supabaseId = user.supabaseId;
    if (!supabaseId) return fail(409, { error: 'No Supabase identity for this user.' });

    const fd = await request.formData();
    if (!fd.get('skip')) {
      const displayName = String(fd.get('displayName') ?? '').trim();
      const language = String(fd.get('language') ?? '');
      if (displayName.length === 0 || displayName.length > 120) {
        return fail(400, { error: 'Enter a display name.' });
      }
      if (!(availableLanguageTags as readonly string[]).includes(language)) {
        return fail(400, { error: 'Pick a language.' });
      }
      await updateSupabaseProfile(supabaseId, { displayName });
      // Same shape the language toggle saves; the "/" hook reads it to pick the
      // locale-prefixed landing page below.
      await upsertUserPreference(getCoreDb(), supabaseId, 'locale', { tag: language });
      invalidateLandingCache(supabaseId);
    }

    const { error } = await supabaseAdmin()
      .from('profiles')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('id', supabaseId);
    if (error) return fail(500, { error: error.message });

    throw redirect(303, '/home');
  },
};
