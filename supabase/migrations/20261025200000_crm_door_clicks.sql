-- Spec 041 Amendment A / F3 item 7: offer-door button clicks (WhatsApp + Reservar), anonymous daily counter.
alter table public.crm_door_stats_daily add column if not exists clicks integer not null default 0;
