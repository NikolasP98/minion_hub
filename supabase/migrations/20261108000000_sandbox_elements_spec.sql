-- Sandbox block kit (spec 049): a block is an element described by JSON and
-- rendered natively with the hub's shared components; custom elements keep
-- html/css/js and a null spec. Validated by the API against the block grammar
-- and the dataset registry before it is stored; never executed.
alter table public.sandbox_elements add column if not exists spec jsonb;
