import postgres from 'postgres';
const db = postgres('postgresql://postgres@127.0.0.1:54399/pos_sellable_test', { max: 1 });
try {
  await db.begin(async (tx) => {
    await tx.unsafe(`set local role app_ledger`);
    await tx.unsafe(`select set_config('app.current_org_id', 'org-rls-a', true)`);
    await tx.unsafe(`insert into fin_products (id, org_id, code, name) values ('00000000-0000-0000-0000-0000000000a1','org-rls-a','RLSA','Visible')`);
    await tx.unsafe(`insert into stk_items (id, org_id, code, name, fin_product_id) values ('00000000-0000-0000-0000-0000000000a2','org-rls-a','RLSA','Visible','00000000-0000-0000-0000-0000000000a1')`);
    await tx.unsafe(`select set_config('app.current_org_id', 'org-rls-b', true)`);
    await tx.unsafe(`do $$ begin if exists (select 1 from fin_products where id = '00000000-0000-0000-0000-0000000000a1') or exists (select 1 from stk_items where id = '00000000-0000-0000-0000-0000000000a2') then raise exception 'cross-org POS rows are visible under app_ledger'; end if; end $$`);
    console.log('RLS negative control PASSED');
    throw new Error('__rollback__');
  });
} catch (e) {
  if (e.message !== '__rollback__') { console.error('FAILED:', e.message); process.exitCode = 1; }
}
await db.end();
