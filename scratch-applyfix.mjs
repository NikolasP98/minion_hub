import postgres from 'postgres';
import fs from 'node:fs';
const admin = postgres('postgresql://postgres@127.0.0.1:54399/postgres', { max: 1 });
try { await admin.unsafe('create database pos_sellable_test'); } catch (e) { console.log('db:', e.message); }
await admin.end();
const db = postgres('postgresql://postgres@127.0.0.1:54399/pos_sellable_test', { max: 1 });
const sql = fs.readFileSync('supabase/ci-fixtures/pos-sellable-transition.sql', 'utf8');
await db.unsafe(sql);
console.log('fixture applied OK');
await db.end();
