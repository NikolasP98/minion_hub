import { sql } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { withOrgCore } from '$server/db/with-org-core';
import { crmContacts } from '$server/db/pg-crm-schema';
import { eq, and } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';
import { getOpenRouterModel } from '$server/llm';

const milestoneItemSchema = z.object({
  label: z.string(),
  at: z.string().optional(),
  detail: z.string().optional(),
});

/**
 * Customer journey map — a chronological strip of milestones (newest first) for
 * the contact detail page. The SPINE is deterministic, derived from real events
 * (purchases via the party spine, bookings, first contact). `analyzeJourney`
 * then layers AI-inferred milestones (e.g. "visited onsite", intent signals)
 * read from message context, persisted on custom_fields._journey so the strip
 * stays populated across reloads without re-calling the model.
 */

export type MilestoneType = 'purchase' | 'reserve' | 'booking' | 'contact' | 'ai';
export interface Milestone {
  id: string;
  type: MilestoneType;
  label: string;
  at: string | null; // ISO
  detail?: string | null;
}

const JOURNEY_MODEL =
  env.CRM_JOURNEY_MODEL || env.CRM_FUNNEL_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash';

const RESERVA = `ii.description ilike '%reserva%'`;

/** Deterministic milestones from structured events (no model). Newest first. */
async function deterministicMilestones(ctx: CoreCtx, contactId: string): Promise<Milestone[]> {
  const finance = await bothEnabled(ctx, 'crm', 'finances');
  return withOrgCore(ctx, async (tx) => {
    const out: Milestone[] = [];

    if (finance) {
      const rows = (await tx.execute(sql`
        select fi.id::text id, fi.issued_at at, coalesce(fi.total,0)::float8 amount,
               bool_or(${sql.raw(RESERVA)}) only_reserva_flag,
               bool_or(ii.description is not null and not (${sql.raw(RESERVA)})) has_proc,
               (select ii2.description from fin_invoice_items ii2
                  where ii2.invoice_id = fi.id and ii2.description is not null
                  order by (ii2.description ilike '%reserva%') asc, ii2.total desc nulls last limit 1) item
        from crm_contacts c
        join fin_clients fc on fc.party_id = c.party_id and c.party_id is not null
          and fc.org_id = current_setting('app.current_org_id', true)
        join fin_invoices fi on fi.client_id = fc.id and fi.status is distinct from 'void'
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        where c.id = ${contactId} and c.org_id = current_setting('app.current_org_id', true)
        group by fi.id, fi.issued_at, fi.total
        order by fi.issued_at desc nulls last
        limit 40
      `)) as unknown as Array<{ id: string; at: string | null; amount: number; has_proc: boolean; item: string | null }>;
      for (const r of rows) {
        const proc = Boolean(r.has_proc);
        out.push({
          id: `inv:${r.id}`,
          type: proc ? 'purchase' : 'reserve',
          label: proc ? (r.item ?? 'Purchase') : 'Reserved a consult',
          at: r.at ? String(r.at) : null,
          detail: `S/ ${Number(r.amount).toLocaleString()}`,
        });
      }
    }

    // Bookings (via crm_contact_id or the shared party).
    const bookings = (await tx.execute(sql`
      select b.id::text id, b.start_time at, coalesce(b.title, 'Appointment') label, b.status
      from sched_bookings b
      where b.org_id = current_setting('app.current_org_id', true)
        and (b.crm_contact_id = ${contactId}
             or b.party_id = (select party_id from crm_contacts where id = ${contactId}))
      order by b.start_time desc nulls last
      limit 20
    `)) as unknown as Array<{ id: string; at: string | null; label: string; status: string }>;
    for (const b of bookings)
      out.push({ id: `bk:${b.id}`, type: 'booking', label: b.label, at: b.at ? String(b.at) : null, detail: b.status });

    // First contact (acquisition) from the ledger stats.
    const [stat] = (await tx.execute(sql`
      select first_contact_at from crm_contact_stats where contact_id = ${contactId}
    `)) as unknown as Array<{ first_contact_at: string | null }>;

    // Ad attribution: enrich the first-contact milestone with the ad/organic
    // origin, matched via the contact's instagram identity (Tier 3 / backfill).
    const [attr] = (await tx.execute(sql`
      select la.origin, la.campaign_name, la.first_contact_at
      from crm_contact_identities ci
      join meta_lead_attribution la
        on la.org_id = ci.org_id and la.channel = ci.channel and la.sender_id = ci.external_id
      where ci.contact_id = ${contactId} and ci.channel = 'instagram'
        and ci.org_id = current_setting('app.current_org_id', true)
      order by la.first_contact_at asc nulls last
      limit 1
    `)) as unknown as Array<{ origin: string | null; campaign_name: string | null; first_contact_at: string | null }>;

    const firstContactAt = stat?.first_contact_at ?? attr?.first_contact_at ?? null;
    if (firstContactAt) {
      const label =
        attr?.origin === 'ad'
          ? `First contact — ${attr.campaign_name ?? 'ad'} ad`
          : attr?.origin === 'organic'
            ? 'First contact — organic'
            : 'First contact';
      out.push({
        id: 'first-contact',
        type: 'contact',
        label,
        at: String(firstContactAt),
        detail: attr?.origin === 'ad' ? (attr.campaign_name ?? null) : null,
      });
    }

    out.sort((a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0));
    return out;
  });
}

/**
 * The journey shown on the page: AI milestones (if a prior analyze run stored
 * them) merged with the live deterministic spine, deduped by id, newest first.
 */
export async function contactJourney(ctx: CoreCtx, contactId: string): Promise<Milestone[]> {
  const base = await deterministicMilestones(ctx, contactId);
  const stored = await withOrgCore(ctx, async (tx) => {
    const [c] = await tx
      .select({ cf: crmContacts.customFields })
      .from(crmContacts)
      .where(and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    const j = (c?.cf as Record<string, unknown> | undefined)?._journey;
    return Array.isArray(j) ? (j as Milestone[]) : [];
  });
  const seen = new Set(base.map((m) => m.id));
  const merged = [...base, ...stored.filter((m) => m && m.id && !seen.has(m.id))];
  merged.sort((a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0));
  return merged;
}

/**
 * AI pass: read recent message context + the deterministic events and ask the
 * model for ADDITIONAL inferred milestones the structured data can't express
 * (e.g. "Asked about Botox pricing", "Visited the clinic"). Stored as type 'ai'
 * on custom_fields._journey. Best-effort; returns the merged journey.
 */
export async function analyzeJourney(ctx: CoreCtx, contactId: string): Promise<Milestone[]> {
  const apiKey = env.OPENROUTER_API_KEY;
  const base = await deterministicMilestones(ctx, contactId);
  if (!apiKey) return base;

  const msgs = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select coalesce(m.occurred_at, m.created_at) at, m.direction, left(m.content, 300) content
      from messages m
      join crm_contact_identities ci on ci.org_id = m.org_id and ci.channel = m.channel and ci.external_id = m.chat_id
      where ci.contact_id = ${contactId} and m.org_id = current_setting('app.current_org_id', true)
        and m.is_bot is not true and m.content is not null and length(trim(m.content)) > 0
      order by coalesce(m.occurred_at, m.created_at) desc
      limit 40
    `),
  )) as unknown as Array<{ at: string | null; direction: string; content: string }>;
  if (msgs.length === 0) return base;

  const eventsCtx = base
    .map((m) => `- [${m.at?.slice(0, 10) ?? '?'}] ${m.label}${m.detail ? ` (${m.detail})` : ''}`)
    .join('\n');
  const convo = msgs
    .slice()
    .reverse()
    .map((m) => `${(m.at ?? '').slice(0, 10)} ${m.direction === 'inbound' ? 'CLIENT' : 'CLINIC'}: ${m.content.replace(/\n/g, ' ')}`)
    .join('\n');

  const prompt = `You build a CUSTOMER JOURNEY for a Peruvian aesthetics clinic (messages mostly Spanish). From the conversation, extract up to 6 concrete MILESTONES that are NOT already in the known events — things like an inquiry about a treatment, a price negotiation, a no-show, a visit, a complaint, or strong purchase intent. Each milestone: a short ENGLISH label (≤5 words) and the ISO date (YYYY-MM-DD) it happened.

Known events (do NOT repeat these):
${eventsCtx || '(none)'}

Conversation (oldest→newest):
${convo}

Return ONLY a JSON array: [{"label":"Asked about Botox","at":"2026-05-01","detail":"price inquiry"}]. No prose. If nothing new, return [].`;

  let aiMilestones: Milestone[] = [];
  try {
    const { object } = await generateObject({
      model: getOpenRouterModel(JOURNEY_MODEL),
      output: 'array',
      schema: milestoneItemSchema,
      prompt,
      temperature: 0.2,
    });
    aiMilestones = object
      .filter((p) => p.label.trim().length > 0)
      .slice(0, 6)
      .map((p, i) => ({
        id: `ai:${p.at ?? 'x'}:${i}:${p.label.slice(0, 20)}`,
        type: 'ai' as const,
        label: p.label.slice(0, 60),
        at: typeof p.at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.at) ? `${p.at.slice(0, 10)}T00:00:00Z` : null,
        detail: typeof p.detail === 'string' ? p.detail.slice(0, 80) : null,
      }));
  } catch {
    return base;
  }

  // Persist AI milestones on the reserved _journey custom field.
  await withOrgCore(ctx, async (tx) => {
    const [c] = await tx
      .select({ cf: crmContacts.customFields })
      .from(crmContacts)
      .where(and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    const cf = { ...((c?.cf as Record<string, unknown>) ?? {}) };
    cf._journey = aiMilestones;
    await tx
      .update(crmContacts)
      .set({ customFields: cf, updatedAt: new Date() })
      .where(and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.tenantId)));
  });

  const merged = [...base, ...aiMilestones];
  merged.sort((a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0));
  return merged;
}
