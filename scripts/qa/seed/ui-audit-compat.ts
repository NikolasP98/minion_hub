/**
 * Keeps the four `ui-audit-*` personas + their org working on the QA stack,
 * so the existing Playwright UI-audit suite (`bun run audit:ui:capture`)
 * runs unchanged against it.
 *
 * `scripts/ui-audit-seed.ts` is a standalone script (`await main()` at module
 * scope — importing it would just run it a second time, uncontrolled), so
 * this reimplements its persona/org/membership shape — copied verbatim
 * (org id, emails, roles, password env var) — and reuses
 * `findOrCreateGoTrueUser` from tenancy.ts for the actual GoTrue call. It
 * deliberately does NOT reseed `scripts/ui-audit-seed.ts`'s dynamic route
 * fixtures (brains/crm/sales/support/flows/…) — run `bun run audit:ui:seed`
 * separately against the QA stack for those; this only guarantees the four
 * logins keep working.
 */
import { findOrCreateGoTrueUser } from './tenancy';
import type { SeedContext } from './db';

const AUDIT_ORG_ID = '00000000-0000-4000-8000-000000000100';
const PASSWORD = process.env.E2E_UI_AUDIT_PASSWORD ?? 'MinionAudit!2026';

const PERSONAS = [
  { id: 'owner', email: 'ui-audit-owner@minion.test', role: 'owner' },
  { id: 'manager', email: 'ui-audit-manager@minion.test', role: 'manager' },
  { id: 'member', email: 'ui-audit-member@minion.test', role: 'staff' },
  { id: 'restricted', email: 'ui-audit-restricted@minion.test', role: 'viewer' },
] as const;

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, admin } = ctx;

  await sql`
    insert into organizations (id, name, slug, kind)
    values (${AUDIT_ORG_ID}, 'Minion UI Audit', 'minion-ui-audit', 'business')
    on conflict (id) do update set name = excluded.name
  `;

  for (const persona of PERSONAS) {
    const id = await findOrCreateGoTrueUser(
      admin,
      `ui-audit-${persona.id}-qa`,
      persona.email,
      PASSWORD,
      {
        full_name: `UI Audit ${persona.id}`,
      },
    );
    await sql`
      insert into profiles (id, email, display_name, role)
      values (${id}, ${persona.email}, ${`UI Audit ${persona.id}`}, 'user')
      on conflict (id) do update set email = excluded.email
    `;
    await sql`
      insert into organization_members (organization_id, profile_id, role)
      values (${AUDIT_ORG_ID}, ${id}, ${persona.role === 'owner' ? 'owner' : 'member'})
      on conflict (organization_id, profile_id) do update set role = excluded.role
    `;
    await sql`
      insert into member_roles (org_id, profile_id, role_key)
      values (${AUDIT_ORG_ID}, ${id}, ${persona.role})
      on conflict (org_id, profile_id, role_key) do nothing
    `;
  }
}
