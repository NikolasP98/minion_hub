-- Spec 124 (F3): immutable stock correction receipts. ONE table for all five kinds
-- (sale_variant, sale_stock_repost, receipt_replace, product_mapping, receipt_chain);
-- F1/F2 consume it. Rows are written once at the end of the correcting transaction
-- (SELECT/INSERT only: no UPDATE/DELETE grant, no applied-then-updated reservation).
-- Requires the F7 authority bridge (20261116190000) at runtime, not at migration time.

-- Supporting unique so correction rows reference entries with a same-org composite FK.
create unique index if not exists stk_entries_org_id_uniq on public.stk_entries (org_id, id);

create table if not exists public.stk_corrections (
  id                    uuid primary key default gen_random_uuid(),
  org_id                text not null,
  operation_key         uuid not null,
  kind                  text not null,
  source_type           text not null,
  source_id             uuid not null,
  source_entry_id       uuid,
  replacement_entry_id  uuid,
  payload_hash          text not null,
  preview_hash          text not null,
  reason                text not null,
  -- Historical identity: plain uuid, no profile/auth FK, so deleting the account keeps the receipt.
  actor_id              uuid not null,
  before                jsonb not null,
  intended              jsonb not null,
  after                 jsonb not null,
  status                text not null default 'applied',
  created_at            timestamptz not null default now(),
  applied_at            timestamptz not null,
  constraint stk_corrections_kind_chk check (
    kind in ('sale_variant', 'sale_stock_repost', 'receipt_replace', 'product_mapping', 'receipt_chain')),
  constraint stk_corrections_source_type_chk check (
    source_type in ('pos_ticket_line', 'stock_receipt', 'fin_product')),
  -- kind -> source type -> entry-reference nullability. sale_variant may carry a source entry with
  -- no replacement (every stock line was removed by the swap) or no entries at all (stockless swap).
  constraint stk_corrections_kind_matrix_chk check (
    (kind = 'product_mapping' and source_type = 'fin_product'
       and source_entry_id is null and replacement_entry_id is null)
    or (kind = 'sale_variant' and source_type = 'pos_ticket_line'
       and (source_entry_id is not null or replacement_entry_id is null))
    or (kind = 'sale_stock_repost' and source_type = 'pos_ticket_line'
       and source_entry_id is not null and replacement_entry_id is not null)
    or (kind in ('receipt_replace', 'receipt_chain') and source_type = 'stock_receipt'
       and source_entry_id is not null and replacement_entry_id is not null)),
  constraint stk_corrections_payload_hash_chk check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint stk_corrections_preview_hash_chk check (preview_hash ~ '^[0-9a-f]{64}$'),
  constraint stk_corrections_reason_chk check (length(btrim(reason)) between 1 and 1000),
  constraint stk_corrections_status_chk check (status = 'applied'),
  constraint stk_corrections_json_size_chk check (
    octet_length(before::text) + octet_length(intended::text) + octet_length(after::text) <= 4194304),
  constraint stk_corrections_source_entry_fk
    foreign key (org_id, source_entry_id) references public.stk_entries (org_id, id),
  constraint stk_corrections_replacement_entry_fk
    foreign key (org_id, replacement_entry_id) references public.stk_entries (org_id, id)
);

-- One global operation namespace per org: a reused key with another kind/payload refuses.
create unique index if not exists stk_corrections_org_operation_key_uniq
  on public.stk_corrections (org_id, operation_key);
-- A receipt is valuation-corrected at most once; a later compensation targets the replacement.
create unique index if not exists stk_corrections_receipt_chain_source_uniq
  on public.stk_corrections (org_id, source_entry_id) where kind = 'receipt_chain';
create index if not exists stk_corrections_org_source_idx
  on public.stk_corrections (org_id, source_type, source_id, created_at desc);

alter table public.stk_corrections enable row level security;
alter table public.stk_corrections force row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = 'stk_corrections' and policyname = 'stk_corrections_org_select') then
    create policy stk_corrections_org_select on public.stk_corrections for select
      using (org_id = current_setting('app.current_org_id', true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = 'stk_corrections' and policyname = 'stk_corrections_org_insert') then
    -- The inserting principal must be the acting profile of the transaction.
    create policy stk_corrections_org_insert on public.stk_corrections for insert
      with check (org_id = current_setting('app.current_org_id', true)
        and actor_id::text = current_setting('app.current_profile_id', true));
  end if;
end $$;

revoke all on public.stk_corrections from public, anon, authenticated;
grant select, insert on public.stk_corrections to app_ledger;
