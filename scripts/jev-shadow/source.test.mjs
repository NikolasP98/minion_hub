import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import postgres from 'postgres';
const url=process.env.JEV_TEST_DATABASE_URL;
test('source role sees only FACES, has no CRM writes, and bounds context in SQL',{skip:!url},async()=>{
 assert.match(url,/^postgres:\/\/[^@]+@127\.0\.0\.1:54422\/minion_qc_jev_[a-z0-9_]+$/);
 const sql=postgres(url,{max:1});try{
 await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='minion_jev_shadow') THEN CREATE ROLE minion_jev_shadow NOLOGIN; END IF; END $$;
 GRANT minion_jev_shadow TO postgres;
 CREATE TABLE organizations(id uuid,slug text);
 CREATE TABLE crm_contacts(id uuid,org_id text,deleted_at timestamptz);
 CREATE TABLE crm_contact_timeline(source_id uuid,contact_id uuid,org_id text,kind text,direction text,occurred_at timestamptz,body text);
 CREATE TABLE crm_tags(id uuid,org_id text,name text,scope text);
 CREATE TABLE crm_contact_tags(contact_id uuid,tag_id uuid,org_id text);
 INSERT INTO organizations VALUES ('11111111-1111-4111-8111-111111111111','faces-sculptors'),('22222222-2222-4222-8222-222222222222','other');
 INSERT INTO crm_contacts VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',null),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',null);
 INSERT INTO crm_contact_timeline SELECT gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','message','inbound',now()-i*interval '1 minute','message' FROM generate_series(1,30) i;`);
 await sql.unsafe(fs.readFileSync(new URL('./source.sql',import.meta.url),'utf8'));
 await sql.begin(async tx=>{
  await tx`set local role minion_jev_shadow`;
  const [p]=await tx`select jev_shadow_source.page(null) as rows`;assert.equal(p.rows.length,1);assert.equal(p.rows[0].contact_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const [a]=await tx`select jev_shadow_source.evidence('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as value`;assert.equal(a.value.messages.length,25);
  const [b]=await tx`select jev_shadow_source.evidence('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as value`;assert.equal(b.value,null);
  const [priv]=await tx`select has_table_privilege(current_user,'crm_contact_tags','INSERT') as can_write`;assert.equal(priv.can_write,false);
 });
 await assert.rejects(sql.begin(async tx=>{await tx`set local role minion_jev_shadow`;await tx`select * from crm_contacts`;}));
 }finally{await sql.end();}
});
