import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { createEntry } from '$server/services/stock.service';
import { ENTRY_TYPES, convertEntryRates } from '$server/services/stock.logic';
import { getFinSettings } from '$server/services/finance.service';

const lineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().max(50).nullable().optional(),
  rate: z.number().nonnegative().nullable().optional(),
  fromWarehouseId: z.string().min(1).nullable().optional(),
  toWarehouseId: z.string().min(1).nullable().optional(),
});

const bodySchema = z.object({
  confirm: z.boolean(),
  type: z.enum(ENTRY_TYPES),
  partyId: z.string().max(200).nullable().optional(),
  note: z.string().max(20_000).nullable().optional(),
  lines: z.array(lineSchema).min(1),
  currency: z.enum(['PEN', 'USD']).optional(),
  rateMode: z.enum(['unit', 'total']).default('unit'),
});

/**
 * POST /api/gateway/actions/stock-entry-create?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, type, partyId?, note?, currency?, rateMode?, lines: [{ itemId, qty, uom?, rate?, fromWarehouseId?, toWarehouseId? }] }
 *
 * Creates a DRAFT stock entry only — submission (which writes the append-only
 * ledger and moves stock) is a deliberate separate step done from the /stock
 * UI, not exposed to the agent in v1.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const { ctx, principalId } = await requireAssistantCapability(locals, url, 'stock', 'create');
  const b = await parseBody(request, bodySchema);
  const fin = await getFinSettings(ctx);
  const inputCurrency = b.currency ?? fin.currency;
  const inputLines = b.lines.map((line) =>
    b.rateMode === 'unit' || line.rate == null
      ? line
      : { ...line, rate: Math.round((line.rate / line.qty) * 10_000) / 10_000 },
  );
  if (inputLines.some((line) => line.rate != null && !Number.isFinite(line.rate)))
    throw error(422, {
      message: 'Line total cannot be represented as a finite unit rate',
      code: 'invalid_rate',
    });
  if (
    inputCurrency !== fin.currency &&
    (fin.fxRate == null || !Number.isFinite(fin.fxRate) || fin.fxRate <= 0)
  )
    throw error(422, {
      message: 'A positive finite exchange rate is required',
      code: 'fx_rate_missing',
    });
  // The native stock API uses this same conversion; preview and creation must
  // normalize into identical valuation-currency unit rates.
  const converted = convertEntryRates({ currency: b.currency, lines: inputLines }, fin);
  if (!converted.ok) throw error(422, { message: converted.message, code: converted.code });
  if (
    converted.lines.some(
      (line) => line.rate != null && (!Number.isFinite(line.rate) || line.rate < 0),
    )
  )
    throw error(422, {
      message: 'Converted unit rate must be finite and nonnegative',
      code: 'invalid_rate',
    });
  const metadata = { ...converted.metadata, inputCurrency, inputRateMode: b.rateMode };

  if (!b.confirm) {
    return json({
      preview: {
        action: 'stock-entry-create',
        type: b.type,
        partyId: b.partyId ?? null,
        note: b.note ?? null,
        inputCurrency,
        inputRateMode: b.rateMode,
        valuationCurrency: fin.currency,
        rateMode: 'unit',
        lines: converted.lines,
        metadata,
      },
    });
  }

  const actor = await agentActor(principalId);
  const entry = await createEntry(
    ctx,
    {
      type: b.type,
      partyId: b.partyId ?? null,
      note: b.note ?? null,
      lines: converted.lines,
      metadata,
    },
    actor,
  );
  return json({ entry }, { status: 201 });
};
