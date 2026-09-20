/** Narrow, repeatable fixtures for both POS flows in the document-required org. */
import { matrixUuid, personaEmail } from './ids';
import { ORG_IDENTITY_REQUIRED } from './tenancy';
import type { SeedContext } from './db';

export const IDENTITY_FIXTURES = {
  org: ORG_IDENTITY_REQUIRED,
  verifiedParty: matrixUuid('pos.identity.verified-customer'),
  missingParty: matrixUuid('pos.identity.missing-document'),
  service: matrixUuid('pos.identity.service'),
  resource: matrixUuid('pos.identity.resource'),
  schedule: matrixUuid('pos.identity.schedule'),
  availability: matrixUuid('pos.identity.availability'),
  eventType: matrixUuid('pos.identity.event-type'),
} as const;

export async function seed(ctx: Pick<SeedContext, 'sql' | 'register'>): Promise<void> {
  const { sql, register } = ctx;
  const f = IDENTITY_FIXTURES;
  const [owner] = await sql<
    { id: string }[]
  >`select id from profiles where email=${personaEmail('tenancy.user.owner')}`;
  if (!owner) throw new Error('Seed the QA owner persona before the identity POS fixtures');
  await sql.begin(async (tx) => {
    await tx`insert into organizations (id, name, slug, kind)
      values (${f.org}, 'QA Identity-Required Org', 'qa-identity-required', 'business') on conflict (id) do nothing`;
    await tx`insert into organization_members (organization_id, profile_id, role)
      values (${f.org}, ${owner.id}, 'owner') on conflict (organization_id, profile_id) do update set role=excluded.role`;
    await tx`insert into member_roles (org_id, profile_id, role_key)
      values (${f.org}, ${owner.id}, 'owner') on conflict (org_id, profile_id, role_key) do nothing`;
    await tx`insert into pos_settings (org_id, requirements)
      values (${f.org}, ${tx.json({ identityDocument: 'required' })})
      on conflict (org_id) do update set requirements=excluded.requirements`;
    await tx`insert into parties (id, org_id, type, name, phone9, doc_type, doc_number, dni_verified)
      values (${f.verifiedParty}, ${f.org}, 'person', 'QA Identity Verified', '999100001', 'DNI', '10000901', true),
             (${f.missingParty}, ${f.org}, 'person', 'QA Identity Missing Document', '999100002', null, null, false)
      on conflict (id) do update set name=excluded.name, phone9=excluded.phone9,
        doc_type=excluded.doc_type, doc_number=excluded.doc_number, dni_verified=excluded.dni_verified`;
    await tx`insert into fin_products (id, org_id, code, name, category, unit_price, active, metadata)
      values (${f.service}, ${f.org}, 'QA-ID-SVC', 'QA Identity Service', 'service', 80, true, '{}')
      on conflict (org_id, code) do update set name=excluded.name, category=excluded.category,
        unit_price=excluded.unit_price, active=excluded.active`;
    await tx`insert into sched_resources (id, org_id, kind, name, timezone, active)
      values (${f.resource}, ${f.org}, 'staff', 'QA Identity Staff', 'America/Lima', true)
      on conflict (id) do update set active=true`;
    await tx`insert into sched_schedules (id, org_id, resource_id, name, timezone, is_default)
      values (${f.schedule}, ${f.org}, ${f.resource}, 'QA Identity Hours', 'America/Lima', true)
      on conflict (id) do nothing`;
    await tx`insert into sched_availability (id, org_id, schedule_id, days, start_time, end_time, date)
      values (${f.availability}, ${f.org}, ${f.schedule}, '{0,1,2,3,4,5,6}', '09:00', '18:00', null)
      on conflict (id) do nothing`;
    await tx`insert into sched_event_types (id, org_id, slug, title, length, requires_confirmation, public, product_id)
      values (${f.eventType}, ${f.org}, 'qa-identity-service', 'QA Identity Service', 30, false, false, ${f.service})
      on conflict (org_id, slug) do update set product_id=excluded.product_id`;
    await tx`insert into sched_event_type_resources (org_id, event_type_id, resource_id)
      values (${f.org}, ${f.eventType}, ${f.resource}) on conflict (event_type_id, resource_id) do nothing`;
    const [openShift] =
      await tx`select id from pos_shifts where org_id=${f.org} and status='open' limit 1`;
    if (!openShift) {
      await tx`insert into pos_shifts (id, org_id, status, opened_by, opening_float)
        values (${matrixUuid('pos.shift.open', 'identity-required-org')}, ${f.org}, 'open', ${owner.id}, ${tx.json({ cash: 200 })})
        on conflict (id) do update set status='open', closed_by=null, closed_at=null`;
    }
  });
  register('pos.identity.owner-membership', {
    table: 'organization_members',
    where: { organization_id: f.org, profile_id: owner.id, role: 'owner' },
  });
  register('pos.identity.owner-role', {
    table: 'member_roles',
    where: { org_id: f.org, profile_id: owner.id, role_key: 'owner' },
  });
  register('pos.identity.verified-customer', {
    table: 'parties',
    where: { id: f.verifiedParty, org_id: f.org, doc_number: '10000901', dni_verified: true },
  });
  register('pos.identity.missing-document', {
    table: 'parties',
    where: { id: f.missingParty, org_id: f.org, dni_verified: false },
  });
  register('pos.identity.service', {
    table: 'fin_products',
    where: { id: f.service, org_id: f.org, active: true },
  });
  register('pos.identity.resource', {
    table: 'sched_resources',
    where: { id: f.resource, org_id: f.org, active: true },
  });
  register('pos.identity.schedule', {
    table: 'sched_schedules',
    where: { id: f.schedule, resource_id: f.resource },
  });
  register('pos.identity.availability', {
    table: 'sched_availability',
    where: { id: f.availability, schedule_id: f.schedule },
  });
  register('pos.identity.event-type', {
    table: 'sched_event_types',
    where: { id: f.eventType, product_id: f.service },
  });
  register('pos.identity.event-resource', {
    table: 'sched_event_type_resources',
    where: { event_type_id: f.eventType, resource_id: f.resource },
  });
}
