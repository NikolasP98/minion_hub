-- Order-line modifiers (item spine #9) — the CONFIGURATION layer.
--
-- Composition (what a thing IS) lives in stk_item_components. This is what a
-- CUSTOMER chose for one line: "no salt", "+ a drink". Keeping it here rather
-- than in the graph is the whole point — encoding choices as composition would
-- mint a new item for every combination.
--
-- Shape: [{ "action": "exclude" | "add", "itemId": "<uuid>", "qty": <number> }]
-- `add.qty` is expressed in the added item's stock UOM per sold line unit.
--   exclude — prune that item wherever it appears in this line's expansion
--             (an ingredient can sit several levels down, e.g. salt inside the
--             mash inside the plate)
--   add     — include an optional item, with qty, on top of the template
-- A qty OVERRIDE is deliberately not supported yet: at depth it is ambiguous
-- (which occurrence?), and nobody has asked for it.
alter table public.pos_ticket_lines
  add column if not exists modifiers jsonb not null default '[]'::jsonb;
