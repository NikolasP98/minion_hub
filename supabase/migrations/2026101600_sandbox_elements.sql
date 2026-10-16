-- Sandbox elements (spec 010-hub-sandbox-pages, plan D7). One row per
-- user-authored visual on a sandbox page: html/css/js rendered inside a
-- sandboxed iframe in the browser, never evaluated on the server. `page`
-- exists so multiple sandbox pages come free; the POC only writes 'default'.
create table if not exists public.sandbox_elements (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  page text not null default 'default',
  title text not null,
  html text not null default '',
  css text not null default '',
  js text not null default '',
  -- grid units, 1..4
  w int not null default 2,
  h int not null default 2,
  position int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sandbox_elements_w_range check (w between 1 and 4),
  constraint sandbox_elements_h_range check (h between 1 and 4)
);
--> statement-breakpoint
create index if not exists sandbox_elements_org_page_position_idx
  on public.sandbox_elements (org_id, page, position);
--> statement-breakpoint
alter table public.sandbox_elements enable row level security;
--> statement-breakpoint
alter table public.sandbox_elements force row level security;
--> statement-breakpoint
grant select, insert, update, delete on public.sandbox_elements to app_ledger;
--> statement-breakpoint
create policy sandbox_elements_org_guc on public.sandbox_elements
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
