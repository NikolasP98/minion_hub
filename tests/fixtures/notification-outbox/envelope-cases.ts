import { expect } from 'vitest';
import { OUTBOX_ORG_A, type NotificationOutboxHarness } from './postgres-harness';
import { asApplicationRole, insertRawEvent } from './runtime-harness';

export async function verifyEnvelopeSqlLimits(harness: NotificationOutboxHarness) {
  const cases: Array<Parameters<typeof insertRawEvent>[1]> = [
    { organizationId: OUTBOX_ORG_A, dedupeKey: 'cap-kind', kind: 'k'.repeat(97) },
    { organizationId: OUTBOX_ORG_A, dedupeKey: 'cap-catalog', catalogRevision: 'c'.repeat(65) },
    { organizationId: OUTBOX_ORG_A, dedupeKey: 'cap-producer', producerId: 'p'.repeat(97) },
    {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'cap-subject-type',
      subjectType: 's'.repeat(49),
    },
    {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'cap-subject-revision',
      subjectRevision: 'é'.repeat(65),
    },
    {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'cap-source',
      sourceIdentity: 'é'.repeat(65),
    },
    { organizationId: OUTBOX_ORG_A, dedupeKey: 'd'.repeat(257) },
    {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'cap-payload',
      payloadCanonical: JSON.stringify({ value: 'é'.repeat(16_385) }),
    },
    {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'cap-semantic',
      semanticSha256: 'a'.repeat(65),
    },
  ];
  for (const event of cases) {
    await expect(
      asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) => insertRawEvent(tx, event)),
    ).rejects.toMatchObject({ code: '23514' });
  }
  const [remaining] = await harness.owner<
    { events: number; outbox: number }[]
  >`select (select count(*)::int from public.notification_events) as events,
    (select count(*)::int from public.notification_outbox) as outbox`;
  expect(remaining).toEqual({ events: 0, outbox: 0 });
}
