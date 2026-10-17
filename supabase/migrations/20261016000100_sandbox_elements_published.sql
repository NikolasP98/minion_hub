-- Component library (spec 014): library entries are element rows on the
-- reserved page 'library'; `published` shares one with the whole org. The
-- creator-or-published visibility rule lives in sandbox.service.listElements.
alter table public.sandbox_elements add column if not exists published boolean not null default false;
