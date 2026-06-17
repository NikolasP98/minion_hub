# CRM Marketing Funnel — Design

**Date:** 2026-06-16
**Status:** Approved (brainstormed interactively)
**Area:** `minion_hub` — CRM plugin (contact detail + customers list)

## Goal

Add a **marketing/acquisition funnel** axis to CRM contacts, visualised on the
contact detail page and surfaced as a column in the Customers list. This is a
SEPARATE axis from the existing RFM **lifecycle** stage (New/Engaged/Active/
Dormant/Churned, which measures engagement *recency*). The funnel measures
*acquisition/conversion progress*.

## Stages (ordered)

```
lead → interest → consideration → intent → customer → loyal
```

| id | label | reached when |
|---|---|---|
| `lead` | Lead | First contact: contact has ≥1 inbound message (asking about the business/services). Baseline for any harvested contact. |
| `interest` | Interest | Message content shows interest in a service/offering (agent sentiment/intent analysis). |
| `consideration` | Consideration | Asking price / availability / comparing (agent). |
| `intent` | Intent | Ready to book / schedule / buy (agent). |
| `customer` | Customer | Has purchased / been treated once. |
| `loyal` | Loyal | **≥2 distinct appointment/payment dates** — returned on a different date and was billed again (more than one treatment). Outranks Customer. |

Rules: auto-detection is **advance-only** (never downgrades). Manual override
can set any stage and marks the stage non-auto.

## Storage (no migration)

On `crm_contacts.custom_fields` under a reserved, display-hidden key:

```jsonc
custom_fields._funnel = {
  stage: 'interest',        // one of the 6 ids
  auto: true,               // true = set by detection/derivation; false = human-pinned
  confidence?: 0.82,        // agent confidence (0–1) when set by analysis
  reason?: '...',           // short agent rationale
  analyzedAt?: '2026-...',  // last agent analysis ISO ts
  updatedAt: '2026-...'
}
```

`_`-prefixed custom-field keys are filtered out of the Details card and the
Customers column editor (`crm-meta` helpers), so `_funnel` is never shown as a
user "property". A dedicated `funnel_stage` column is deferred (would need a
migration); jsonb is sufficient for v1.

## Effective stage (pure helper — `src/lib/components/crm/crm-funnel.ts`)

Shared client + server, no I/O:

- `FUNNEL_STAGES: { id, label }[]` (ordered) and `FUNNEL_ORDER: string[]`.
- `funnelStageIndex(id): number`.
- `effectiveFunnelStage(customFields, { inbound }): string | null`
  - stored `_funnel.stage` if present;
  - else baseline `'lead'` when `inbound > 0`;
  - else `null` (manual contact, no messages → nothing reached).
- `funnelStageLabel(id)` → i18n message.

## Transitions logged

Every stage change writes a `crm_activities` row: `kind='funnel'`,
`data={ from, to, by:'auto'|'agent'|'user', reason, confidence? }`. Audit trail;
surfacing in the journey timeline is a later nicety.

## Components

1. **`CrmFunnel.svelte`** (the visual) — vertical tapering funnel, 6 bands,
   widest (Lead) at top → narrowest (Loyal) at the tip. Reached bands filled,
   current band accent + `◀ now` marker, future bands dim. Below: current stage
   label + agent reason/confidence hint when present; inline manual override
   (click a band or a small select to pin a stage); a **"Re-analyze"** button
   that triggers the agent pass. Mounted in the detail page left column under
   the Lifecycle card.
2. **`FunnelStagePill.svelte`** — compact colored pill (mirrors `StagePill`),
   used in the Customers list column and inside `CrmFunnel`. Per-stage palette
   (lead=slate, interest=cyan, consideration=violet, intent=amber,
   customer=emerald, loyal=gold/accent).

## Customers list column

Add a **Funnel** column next to the existing *Stage* column in
`crm/customers/+page.svelte`, rendered with `FunnelStagePill` and a
`ColumnFilter` dropdown. Computed client-side via `effectiveFunnelStage(
c.custom_fields, { inbound: c.inbound_msgs })` — no server/roster change (the
roster already carries `custom_fields` and `inbound_msgs`). Auto-`Loyal` (needs
billing counts) is computed on the detail/analyze path and persisted to
`_funnel`, so the list reflects it once known.

## Server

- **`setFunnelStage(ctx, id, stage, { by, reason, confidence, auto })`** in
  `crm-contacts.service.ts` — merges `_funnel` into `custom_fields`, inserts the
  `crm_activities` funnel row, busts the CRM list + contact caches. Advance-only
  guard for `by !== 'user'`.
- **`distinctVisitDates(ctx, id): Promise<number>`** — the Loyal seam.
  **Stubbed in v1** (returns 0; billing/appointments are a follow-up feature).
  When wired it counts distinct dates from billing/appointment events.
- **`PATCH /api/crm/contacts/[id]/funnel { stage }`** — manual override
  (`by:'user'`, `auto:false`). Validates stage id.
- **`POST /api/crm/contacts/[id]/funnel/analyze`** — loads recent **inbound**
  message bodies from `crm_contact_timeline` (`direction='inbound'`, non-empty
  `body`), runs the LLM (reusing the `generateText` + `createOpenAI`/OpenRouter
  pattern from `api/crm/cleanup/review`; model
  `CRM_FUNNEL_MODEL ?? CRM_CLEANUP_MODEL ?? NOTES_POLISH_MODEL ?? 'google/gemini-2.5-flash'`),
  classifies → `{ stage, confidence, reason }`. Also calls `distinctVisitDates`
  (stub) — ≥2 ⇒ would force `loyal`. Auto-applies (advance-only) when stored
  stage is `auto` or unset; if human-pinned (`auto:false`), returns the
  suggestion as a hint WITHOUT overwriting. Returns `{ stage, confidence,
  reason, applied }`.

### Agent prompt

Spanish / Peruvian aesthetics-clinic context. Given the contact's recent
inbound messages, classify their funnel position: generic first contact /
greeting → `lead`; expressing interest in a service/offering → `interest`;
asking price / availability / comparing → `consideration`; ready to book /
schedule → `intent`; already treated / a client → `customer`. (`loyal` is NOT
agent-decided — it's billing-derived, deferred.) Return ONLY JSON
`{"stage":"...","confidence":0.0,"reason":"short"}`. temperature 0.

## Trigger (this iteration)

On-demand via the "Re-analyze" button, plus a one-time auto-run on first detail
view when `_funnel.analyzedAt` is missing and inbound messages exist (so a fresh
contact gets classified once without a surprise LLM call on every visit).
Hooking analysis into live gateway message ingestion is the natural follow-up.

## i18n

New `crm_funnel_*` keys in `messages/{en,es}.json` (6 stage labels, card title,
analyze / analyzing, "now", suggested-hint, override label, "not analyzed yet")
+ recompile paraglide.

## Out of scope (follow-ups)

- Billing/appointments data source + auto-`Loyal` (`distinctVisitDates` real impl).
- Gateway ingestion hook that auto-analyzes on each new inbound message.
- Dedicated `funnel_stage` DB column + migration (jsonb is fine for v1).
- Surfacing funnel transitions in the journey timeline.

## Verification

`bun run check` → 0/0. Manual: detail page shows funnel; manual override
persists + logs activity; analyze advances auto stage; Customers list Funnel
column + filter work; `_funnel` hidden from Details/column editor.
