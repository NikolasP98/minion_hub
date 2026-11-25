-- Spec 148: "Caja automática". `auto` = the first sale of the day opens the
-- cashier's shift and a daily job closes every open shift at local midnight
-- (counted = expected), which sends the day's tickets to SUNAT. `manual`
-- (default) keeps the open/close dialogs exactly as before.
alter table public.pos_settings
  add column if not exists shift_mode text not null default 'manual';
--> statement-breakpoint
alter table public.pos_settings
  drop constraint if exists pos_settings_shift_mode_chk;
--> statement-breakpoint
alter table public.pos_settings
  add constraint pos_settings_shift_mode_chk check (shift_mode in ('manual', 'auto'));
