-- Meta spec 131: substitute items in a recipe. Null = always consumed (every
-- existing row, so behaviour is unchanged); `1.0/2.1` = option 0 of choice 1,
-- then option 1 of choice 2. Rows in one choice but different options are
-- alternatives; a choice's lowest option is its default.
alter table public.stk_consumption add column if not exists choice_path text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stk_consumption_choice_path_chk'
  ) then
    alter table public.stk_consumption
      add constraint stk_consumption_choice_path_chk
      check (choice_path is null or choice_path ~ '^[0-9]{1,4}\.[0-9]{1,4}(/[0-9]{1,4}\.[0-9]{1,4})*$');
  end if;
end $$;
