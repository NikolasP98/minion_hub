import {
  capturedPostgresDdl,
  quoteCatalogIdentifier as qi,
  type CapturedCatalog,
} from './captured-postgres-catalog';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { AttachmentAccess } from '$server/services/attachment-access';

/** Minimal PGlite service-seam substrate only; never used for native/RLS qualification. */
export const ATTACHMENT_FIXTURE_DDL = `
CREATE TABLE files (id text PRIMARY KEY,tenant_id uuid NOT NULL,uploaded_by uuid,b2_file_key text NOT NULL,file_name text NOT NULL,
 content_type text NOT NULL,size_bytes bigint NOT NULL,category text NOT NULL DEFAULT 'general',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE crm_contacts (id uuid PRIMARY KEY,org_id text NOT NULL,owner_id uuid,deleted_at timestamptz);
CREATE TABLE sched_bookings (id uuid PRIMARY KEY,org_id text NOT NULL);
CREATE TABLE sched_event_types (id uuid PRIMARY KEY,org_id text NOT NULL);
CREATE TABLE fin_products (id uuid PRIMARY KEY,org_id text NOT NULL);
CREATE TABLE stk_items (id uuid PRIMARY KEY,org_id text NOT NULL);
CREATE TABLE stk_entries (id uuid PRIMARY KEY,org_id text NOT NULL);
CREATE TABLE fin_invoices (id uuid PRIMARY KEY,org_id text NOT NULL);
CREATE TABLE pos_tickets (id uuid PRIMARY KEY,org_id text NOT NULL);
CREATE TABLE doc_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id text NOT NULL,ref_type text NOT NULL,ref_id uuid NOT NULL,
 actor_id uuid,actor_name text,op text NOT NULL,changes jsonb NOT NULL DEFAULT '[]',occurred_at timestamptz NOT NULL DEFAULT now());
`;
export const ORG = '10000000-0000-4000-8000-000000000001';
export const OTHER_ORG = '10000000-0000-4000-8000-000000000002';
export const USER = '20000000-0000-4000-8000-000000000001';
export const OTHER_USER = '20000000-0000-4000-8000-000000000002';
export const CONTACT = '30000000-0000-4000-8000-000000000001';
export const BOOKING = '30000000-0000-4000-8000-000000000002';
export const INVOICE = '30000000-0000-4000-8000-000000000003';
export const migrations = [
  '20260912090100_attachment_links.sql',
  '20260913020000_attachment_file_state.sql',
  '20260913030000_attachment_trash.sql',
] as const;
export function migrationSource(name: (typeof migrations)[number]) {
  return readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
}
export function access(
  overrides: Partial<AttachmentAccess['modules']> = {},
  profileId = USER,
  tenantId = ORG,
): AttachmentAccess {
  return {
    tenantId,
    profileId,
    modules: {
      crm: { view: true, edit: true },
      scheduling: { view: true, edit: true },
      pos: { view: true, edit: true },
      stock: { view: true, edit: true },
      finance: { view: true, edit: true },
      ...overrides,
    },
  };
}
function capturedCatalog(file: string): {
  catalog: CapturedCatalog;
  provenance: Record<string, string>;
} {
  return JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
}
const domainCatalog = capturedCatalog('attachment-catalog.json');
const authCatalog = capturedCatalog('attachment-auth-catalog.json');
export function capturedAttachmentDdl(schema: string, authSchema: string) {
  return capturedPostgresDdl(schema, authSchema, domainCatalog.catalog, authCatalog.catalog);
}
export async function openAttachmentFixture() {
  const harness = await openDisposablePostgres();
  const schema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
  // DDL runs on the harness owner; the fixture then talks to the schema over a
  // connection whose search_path is a startup parameter, so it survives the
  // harness's 5 s idle reconnect (a session-level SET would not).
  const ddl = harness.owner;
  try {
    const authSchema = `${schema}_auth`;
    await ddl.unsafe(capturedAttachmentDdl(schema, authSchema));
    // Adversarial default grants on the NEW table exercise the migration's
    // explicit revocation; existing captured table ACLs above remain exact.
    await ddl.unsafe(
      `ALTER DEFAULT PRIVILEGES FOR ROLE minion_qc IN SCHEMA "${schema}" GRANT ALL ON TABLES TO anon,authenticated;`,
    );
    // attachment_links already exists exactly as captured; apply the newer migrations only.
    for (const file of migrations.slice(1))
      await ddl.unsafe(
        migrationSource(file)
          .replaceAll('public.', `"${schema}".`)
          .replaceAll("schemaname='public'", `schemaname='${schema}'`),
      );
    const owner = harness.createConnection(schema);
    const client = harness.createConnection(schema);
    const db = drizzle(client, { schema: pgSchema });
    const ctx: CoreCtx = { db, tenantId: ORG, profileId: USER };
    return {
      harness,
      schema,
      owner,
      client,
      ctx,
      connection: () => {
        const client = harness.createConnection(schema);
        return { client, ctx: { ...ctx, db: drizzle(client, { schema: pgSchema }) } };
      },
      reset: async () => {
        await owner.unsafe(
          `TRUNCATE ${domainCatalog.catalog.relations.map((r) => qi(r.relname)).join(',')},attachment_file_state,attachment_trash,${qi(authSchema)}.users`,
        );
        await owner.unsafe(
          `INSERT INTO ${qi(authSchema)}.users(id,email) VALUES ('${USER}','owner@example.invalid'),('${OTHER_USER}','other@example.invalid')`,
        );
        await owner`INSERT INTO organizations(id,name) VALUES (${ORG},'Disposable org'),(${OTHER_ORG},'Other disposable org')`;
        await owner`INSERT INTO organization_members(organization_id,profile_id) VALUES (${ORG},${USER}),(${OTHER_ORG},${OTHER_USER})`;
        await owner`INSERT INTO crm_contacts(id,org_id,owner_id) VALUES (${CONTACT},${ORG},${USER})`;
        await owner`INSERT INTO sched_event_types(id,org_id,slug,title,length) VALUES ('40000000-0000-4000-8000-000000000001',${ORG},'fixture','Fixture',30)`;
        await owner`INSERT INTO sched_resources(id,org_id,name) VALUES ('40000000-0000-4000-8000-000000000002',${ORG},'Fixture')`;
        await owner`INSERT INTO sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time)
          VALUES (${BOOKING},${ORG},'fixture-booking','40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',now(),now()+interval '30 minutes')`;
        await owner`INSERT INTO fin_invoices(id,org_id,provider,provider_ref) VALUES (${INVOICE},${ORG},'internal','fixture-invoice')`;
      },
      seedRecord: async (
        objectType: import('$server/db/pg-attachments-schema').AttachmentObjectType,
        tenantId = ORG,
      ) => {
        const id = crypto.randomUUID();
        switch (objectType) {
          case 'crm_contact':
            await owner`INSERT INTO crm_contacts(id,org_id,owner_id) VALUES (${id},${tenantId},${USER})`;
            break;
          case 'booking':
            await owner`INSERT INTO sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time)
            VALUES (${id},${tenantId},${id},'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',now(),now()+interval '30 minutes')`;
            break;
          case 'event_type':
            await owner`INSERT INTO sched_event_types(id,org_id,slug,title,length) VALUES (${id},${tenantId},${id},'Fixture',30)`;
            break;
          case 'product':
            await owner`INSERT INTO fin_products(id,org_id,code,name) VALUES (${id},${tenantId},${id},'Fixture')`;
            break;
          case 'stk_item':
            await owner`INSERT INTO stk_items(id,org_id,code,name) VALUES (${id},${tenantId},${id},'Fixture')`;
            break;
          case 'stk_entry':
            await owner`INSERT INTO stk_entries(id,org_id,type) VALUES (${id},${tenantId},'MaterialReceipt')`;
            break;
          case 'fin_invoice':
            await owner`INSERT INTO fin_invoices(id,org_id,provider,provider_ref) VALUES (${id},${tenantId},'internal',${id})`;
            break;
          case 'pos_ticket': {
            const shift = crypto.randomUUID();
            await owner`INSERT INTO pos_shifts(id,org_id) VALUES (${shift},${tenantId})`;
            await owner`INSERT INTO pos_tickets(id,org_id,shift_id,subtotal,total) VALUES (${id},${tenantId},${shift},0,0)`;
            break;
          }
        }
        return { objectType, objectId: id };
      },
      seedFile: async (
        id = 'file-a',
        options: {
          tenantId?: string;
          uploadedBy?: string;
          category?: string;
          key?: string;
          old?: boolean;
          registered?: boolean;
        } = {},
      ) => {
        const tenant = options.tenantId ?? ORG;
        const key = options.key ?? `${tenant}/attachments/${id}/file.pdf`;
        await owner`INSERT INTO files(id,tenant_id,uploaded_by,b2_file_key,file_name,content_type,size_bytes,category,created_at) VALUES (${id},${tenant},${options.uploadedBy ?? USER},${key},'file.pdf','application/pdf',42,${options.category ?? 'attachment'},${options.old ? new Date(Date.now() - 48 * 3600000) : new Date()})`;
        if (
          options.registered !== false &&
          ((options.category ?? 'attachment') === 'attachment' ||
            key.startsWith(`${tenant}/attachments/`))
        )
          await owner`INSERT INTO attachment_file_state(file_id,org_id,file_key,access_modules) VALUES (${id},${tenant},${key},ARRAY['crm'])`;
        return key;
      },
      receipt: {
        ...harness.identity,
        schema,
        authSchema,
        namespaceMapping: { public: schema, auth: authSchema },
        ownerMapping: { postgres: 'minion_qc' },
        catalogProvenance: [domainCatalog.provenance, authCatalog.provenance],
        ddlSha256: createHash('sha256')
          .update(capturedAttachmentDdl(schema, authSchema))
          .digest('hex'),
        migrations: migrations.map((file) => ({
          file,
          sha256: createHash('sha256').update(migrationSource(file)).digest('hex'),
        })),
      },
      close: async () => {
        try {
          await owner.unsafe(
            `DROP SCHEMA "${schema}" CASCADE; DROP SCHEMA "${schema}_auth" CASCADE`,
          );
        } finally {
          await harness.close();
        }
      },
    };
  } catch (e) {
    try {
      await owner.unsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE; DROP SCHEMA IF EXISTS "${schema}_auth" CASCADE`,
      );
    } finally {
      await harness.close();
    }
    throw e;
  }
}
export async function waitForDatabaseLock(
  owner: Awaited<ReturnType<typeof openAttachmentFixture>>['owner'],
  pid: number,
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await owner`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected native lock barrier was not reached');
}
export function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
