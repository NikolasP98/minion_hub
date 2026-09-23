-- Managed, colored Select options for the POS catalog category column. Keep
-- fin_products.category as the stored display value so existing APIs/imports
-- remain compatible; the composite FK turns option rename/delete into atomic
-- product updates and rejects stale values after deletion.

create table public.fin_product_categories (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  name text not null,
  color text not null check (color in (
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7',
    '#06b6d4', '#ec4899', '#f97316', '#6366f1', '#6b7280'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_product_categories_org_name_uniq unique (org_id, name)
);
--> statement-breakpoint

-- Preserve every exact legacy value, including case and whitespace variants.
-- Color assignment is deterministic within each org and has no semantic effect.
insert into public.fin_product_categories (org_id, name, color)
select org_id, category,
  (array['#3b82f6','#10b981','#f59e0b','#ef4444','#a855f7',
         '#06b6d4','#ec4899','#f97316','#6366f1','#6b7280'])[
    1 + ((row_number() over (partition by org_id order by category) - 1) % 10)::int
  ]
from (select distinct org_id, category from public.fin_products where category is not null) legacy;
--> statement-breakpoint

alter table public.fin_products
  add constraint fin_products_category_fk
  foreign key (org_id, category)
  references public.fin_product_categories (org_id, name)
  on update cascade
  on delete set null (category);
--> statement-breakpoint

grant select, insert, update, delete on public.fin_product_categories to app_ledger;
--> statement-breakpoint
alter table public.fin_product_categories enable row level security;
--> statement-breakpoint
alter table public.fin_product_categories force row level security;
--> statement-breakpoint
create policy fin_product_categories_org_guc on public.fin_product_categories
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
