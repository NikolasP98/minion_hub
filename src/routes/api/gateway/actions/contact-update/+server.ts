import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import { sanitizeContactFields } from '$lib/pii';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { updateContact, setFunnelStage, addNote } from '$server/services/crm-contacts.service';
import { StaleWriteError } from '$server/services/errors';

const bodySchema = z
  .object({
    confirm: z.boolean(),
    contactId: z.string().min(1).max(200),
    name: z.string().max(500).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    email: z.string().max(320).nullable().optional(),
    funnelStage: z.string().max(200).optional(),
    notes: z.string().max(20_000).optional(),
    expectedUpdatedAt: z.coerce.date().optional(),
  })
  .refine(
    (b) =>
      b.name !== undefined ||
      b.phone !== undefined ||
      b.email !== undefined ||
      b.funnelStage ||
      b.notes,
    'at least one of name/phone/email/funnelStage/notes is required',
  );

/**
 * POST /api/gateway/actions/contact-update?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, contactId, name?, phone?, email?, funnelStage?, notes?, expectedUpdatedAt? }
 *
 * Whitelisted fields per the plan (name/phone/email/funnel stage/notes). email
 * and funnel stage have no dedicated columns on crm_contacts — email lives in
 * custom_fields, written through updateContact's `customFieldsPatch` (a single
 * atomic patch that touches only that key), and funnel stage goes through the
 * dedicated setFunnelStage (advance-only unless by:'user'; an agent write is
 * by:'agent', matching the service's own semantics for automated callers).
 *
 * Every `custom_fields` this route puts on the wire goes through
 * `sanitizeContactFields` — the same ONE serialization gate the roster, detail
 * and PATCH paths use — so the internal inference leases (`_relationshipClaim`
 * / `_icpClaim`) reach NO caller, and a field-level-masked principal gets no
 * `_relationship`, no `_icp` free text and no raw PII. Masking is derived from
 * the resolved `capabilities` (field level is independent of `crm:edit`), NOT
 * from `shouldMaskSensitive(locals, …)`: that helper keys off `locals.user`,
 * which is unset for gateway/server-token callers — same reason
 * `query/finance` uses `capabilities.fieldLevel()`.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const { ctx, capabilities } = await requireAssistantCapability(locals, url, 'crm', 'edit');
  const b = await parseBody(request, bodySchema);
  const maskSensitive = capabilities.fieldLevel('crm') < SENSITIVE_FIELD_LEVEL;
  const serializeContact = <T extends { customFields?: unknown } | null>(row: T): T =>
    row
      ? {
          ...row,
          customFields: sanitizeContactFields(
            row.customFields as Record<string, unknown> | null,
            maskSensitive,
          ),
        }
      : row;

  if (!b.confirm) {
    return json({
      preview: {
        action: 'contact-update',
        contactId: b.contactId,
        name: b.name,
        phone: b.phone,
        email: b.email,
        funnelStage: b.funnelStage,
        notes: b.notes,
      },
    });
  }

  let updatedContact: unknown = null;
  if (b.name !== undefined || b.phone !== undefined || b.email !== undefined) {
    // `email: null` is a real edit (clear the field), so key on `!== undefined`
    // — the same distinction the zod schema draws for name/phone.
    const customFieldsPatch = b.email !== undefined ? { email: b.email } : undefined;
    try {
      updatedContact = await updateContact(
        ctx,
        b.contactId,
        { displayName: b.name, phone: b.phone, customFieldsPatch },
        b.expectedUpdatedAt,
      );
    } catch (e) {
      if (e instanceof StaleWriteError)
        return json(
          {
            error: 'stale',
            current: serializeContact(e.current as { customFields?: unknown } | null),
          },
          { status: 409 },
        );
      throw e;
    }
    if (!updatedContact) throw error(404, 'contact not found');
    updatedContact = serializeContact(updatedContact as { customFields?: unknown });
  }

  let funnel: { applied: boolean; stage: string } | null = null;
  if (b.funnelStage) {
    funnel = await setFunnelStage(ctx, b.contactId, b.funnelStage, {
      by: 'agent',
      reason: 'set by agent',
    });
  }

  if (b.notes) {
    await addNote(ctx, b.contactId, b.notes, ctx.profileId ?? null);
  }

  return json({ contact: updatedContact, funnel });
};
