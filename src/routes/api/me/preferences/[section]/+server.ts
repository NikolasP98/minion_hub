import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreDb } from '$server/db/pg-client';
import { upsertUserPreference } from '$server/services/user-preferences.service';
import { invalidateLandingCache } from '$server/landing-cache';

const VALID_SECTIONS = new Set([
  'theme',
  'crt',
  'bgPattern',
  'sparklineStyle',
  'logo',
  'locale',
  'landingPage',
  'navOrder',
  'calendar',
  'recordOverview',
  'tableOpenIn',
  'appointmentServicesColumns',
]);

const RECORD_OVERVIEW_TABLE_ID_MAX = 40;
const RECORD_OVERVIEW_TABLE_IDS_MAX = 200;
const TABLE_OPEN_IN_TABLE_ID_MAX = 40;
const TABLE_OPEN_IN_TABLE_IDS_MAX = 200;
const OPEN_MODES = new Set(['page', 'modal', 'tray']);
/** Hideable columns on the `AppointmentForm` picked-services table (spec
 *  2026-09-30 owner feedback: kebab-configurable Duration/Price columns). */
const APPOINTMENT_SERVICES_HIDEABLE_COLUMNS = new Set(['duration', 'price']);

/** `string[]` of hidden column keys — modeled on `isValidTableOpenIn`. */
function isValidAppointmentServicesColumns(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length <= APPOINTMENT_SERVICES_HIDEABLE_COLUMNS.size &&
    v.every((k) => typeof k === 'string' && APPOINTMENT_SERVICES_HIDEABLE_COLUMNS.has(k))
  );
}

/** `{ [tableId]: { hidden: string[] } }` — per-user hidden-field set for a
 *  record detail's Overview card (spec 2026-09-28 Bundle C #1). */
function isValidRecordOverview(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > RECORD_OVERVIEW_TABLE_IDS_MAX) return false;
  return entries.every(([tableId, entry]) => {
    if (tableId.length > RECORD_OVERVIEW_TABLE_ID_MAX) return false;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const hidden = (entry as Record<string, unknown>).hidden;
    return Array.isArray(hidden) && hidden.every((k) => typeof k === 'string');
  });
}

/** `{ [tableId]: 'page' | 'modal' | 'tray' }` — per-user open-mode override,
 *  read by `openModeFor` (spec 2026-09-28 Bundle E #3). */
function isValidTableOpenIn(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > TABLE_OPEN_IN_TABLE_IDS_MAX) return false;
  return entries.every(
    ([tableId, mode]) =>
      tableId.length > 0 &&
      tableId.length <= TABLE_OPEN_IN_TABLE_ID_MAX &&
      OPEN_MODES.has(mode as string),
  );
}

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const { section } = params;
  if (!section || !VALID_SECTIONS.has(section)) {
    throw error(400, `Invalid preference section: ${section}`);
  }
  // Preferences are keyed by profile_id (Supabase auth uuid) in Postgres.
  if (!user.supabaseId) throw error(409, 'No Supabase identity for this user');
  const body = await request.json();

  // The landing page is consumed by the "/" redirect in hooks.server.ts, so a
  // poisoned value is an open-redirect vector. Constrain it to a safe
  // root-relative path at write time (defense in depth — the redirect also
  // re-validates). Disallows absolute URLs, protocol-relative `//host`, and
  // backslash tricks; allows query strings (e.g. /agents?archetype=copilot).
  if (section === 'landingPage') {
    const v = body.value;
    if (typeof v !== 'string' || !/^\/(?![/\\])[A-Za-z0-9/_\-?=&.]*$/.test(v)) {
      throw error(400, 'Invalid landing page path');
    }
  }
  if (section === 'calendar') {
    const v = body.value;
    if (!v || typeof v !== 'object' || typeof v.showInheritedTags !== 'boolean') {
      throw error(400, 'Invalid calendar preference');
    }
  }
  if (section === 'recordOverview' && !isValidRecordOverview(body.value)) {
    throw error(400, 'Invalid recordOverview preference');
  }
  if (section === 'tableOpenIn' && !isValidTableOpenIn(body.value)) {
    throw error(400, 'Invalid tableOpenIn preference');
  }
  if (section === 'appointmentServicesColumns' && !isValidAppointmentServicesColumns(body.value)) {
    throw error(400, 'Invalid appointmentServicesColumns preference');
  }

  await upsertUserPreference(getCoreDb(), user.supabaseId, section, body.value);
  // Drop the per-instance landing cache so the next `/` hit reflects the change
  // immediately instead of redirecting to the old home for up to the TTL.
  // Both sections feed the `/` redirect (path + locale prefix).
  if (section === 'landingPage' || section === 'locale') invalidateLandingCache(user.supabaseId);
  return json({ ok: true });
};
