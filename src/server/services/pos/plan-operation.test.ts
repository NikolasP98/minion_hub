import { describe, expect, it } from 'vitest';
import type { PlanInput } from '../pos-accounts.service';
import { planOperationId, planRequestHash, planRequestHashV2 } from './plan-operation';
import { moneyNumber } from './money';
import { validateDueSchedule } from './payment-plan-schedule';
const base: PlanInput = {
  client: { partyId: 'ABCDEF00-0000-4000-8000-000000000001' },
  title: '  Agreement  ',
  totalAmount: 1.005,
};
function hash(input: PlanInput) {
  const total = moneyNumber(input.totalAmount, { numeric12: true });
  return planRequestHash(input, {
    total,
    dueSchedule: validateDueSchedule(input.dueSchedule, total),
  });
}
function hashV2(input: PlanInput) {
  const total = moneyNumber(input.totalAmount, { numeric12: true });
  return planRequestHashV2(input, {
    total,
    dueSchedule: validateDueSchedule(input.dueSchedule, total),
  });
}
describe('plan operation canonical intent', () => {
  it('canonicalizes UUID case title principal and absent optional facets', () => {
    expect(hash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(hash(base)).toBe(
      hash({
        ...base,
        client: { partyId: base.client.partyId!.toLowerCase(), crmContactId: null },
        title: 'Agreement',
        totalAmount: 1.01,
        dueSchedule: [],
        note: null,
        bookingId: null,
        productId: null,
      }),
    );
    expect(planOperationId(base.client.partyId)).toBe(base.client.partyId!.toLowerCase());
  });
  it('normalizes distinct due dates while preserving stable same-date intent order', () => {
    const a = [
      { dueOn: '2026-11-03', amount: 0.51 },
      { dueOn: '2026-10-03', amount: 0.5 },
    ];
    expect(hash({ ...base, dueSchedule: a })).toBe(
      hash({ ...base, dueSchedule: [...a].reverse() }),
    );
    const same = a.map((row) => ({ ...row, dueOn: '2026-10-03' }));
    expect(hash({ ...base, dueSchedule: same })).not.toBe(
      hash({ ...base, dueSchedule: [...same].reverse() }),
    );
  });
  it('distinguishes omitted currency and every financially relevant request field', () => {
    const patches: Partial<PlanInput>[] = [
      { currency: 'PEN' },
      { note: '' },
      { title: 'Other' },
      { totalAmount: 2 },
      { productId: base.client.partyId },
      { bookingId: base.client.partyId },
      { client: { crmContactId: base.client.partyId } },
      { dueSchedule: [{ dueOn: '2026-10-03', amount: 1.01 }] },
    ];
    for (const patch of patches) expect(hash({ ...base, ...patch })).not.toBe(hash(base));
    expect(hash({ ...base, currency: ' pen ' })).toBe(hash({ ...base, currency: 'PEN' }));
  });
  it('ignores caller actor labels and operation identity but rejects malformed references', () => {
    expect(
      hash({
        ...base,
        operationId: crypto.randomUUID(),
        actor: { id: crypto.randomUUID(), name: 'PII must not affect intent' },
      }),
    ).toBe(hash(base));
    expect(() => hash({ ...base, bookingId: 'invalid' })).toThrow();
    for (const id of [undefined, null, '', 'bad', 42]) expect(() => planOperationId(id)).toThrow();
  });

  it('keeps the legacy serializer byte-compatible and binds new operations to a canonical key', () => {
    const lowerParty = base.client.partyId!.toLowerCase();
    expect(hash(base)).toBe('00853062d1703268766e5838fdbaf85c74ad508af7c8f393da5b433b552f69a8');
    const v2 = hashV2({ ...base, clientKey: `party:${lowerParty}` });
    expect(v2).toMatch(/^[0-9a-f]{64}$/);
    expect(v2).not.toBe(hash(base));
    expect(v2).toBe(hashV2({ ...base, clientKey: `party:${base.client.partyId}` }));
    expect(
      hashV2({
        ...base,
        clientKey: 'contact:abcdef00-0000-4000-8000-000000000001',
      }),
    ).not.toBe(v2);
    for (const clientKey of [undefined, 'party:bad', 'tenant:' + lowerParty]) {
      expect(() => hashV2({ ...base, clientKey })).toThrowError(
        expect.objectContaining({ code: 'wallet_identity_required' }),
      );
    }
  });
});
