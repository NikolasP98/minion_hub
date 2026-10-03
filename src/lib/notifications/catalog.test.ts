import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { BOOKING_STATUSES } from '$lib/components/scheduling/booking-status';
import {
  canonicalNotificationPayload,
  decodeNotificationPayload,
  NOTIFICATION_PAYLOAD_LIMIT,
  NotificationInputError,
} from './canonical';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATALOG_REVISION,
  NOTIFICATION_KINDS,
  notificationSettingsCatalog,
  parseEncodedNotificationPayload,
  parseNotificationPayload,
  requireNotificationAdapter,
  type NotificationKind,
} from './catalog';
import { notificationCatalogManifest, assertNotificationCatalogRevision } from './catalog-manifest';
import { BOOKING_STATUS_VALUES } from './fields';
import { NOTIFICATION_POLICY_CONTRACTS } from './policy-contracts';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const instant = '2026-10-03T10:00:00.000Z';
/** Explicit examples from the product contract; not generated from field validators. */
const examples = {
  'scheduling.booking.upcoming': {
    bookingId: id,
    bookingRevision: 'v1',
    windowKey: '2026-10-03',
    scheduledFor: instant,
  },
  'domain.status.changed': {
    adapter: 'scheduling.booking',
    bookingId: id,
    bookingRevision: 'v2',
    fromStatus: 'pending',
    toStatus: 'accepted',
  },
  'stock.low.crossed': {
    itemId: id,
    warehouseId: other,
    crossingId: id,
    policyRevision: 'v1',
    snapshotId: id,
  },
  'join.requested': { requestId: id, applicantProfileId: other },
  'join.approved': { requestId: id, applicantProfileId: other, decidedAt: instant },
  'join.denied': { requestId: id, applicantProfileId: other, decidedAt: instant },
  'membership.activated': { profileId: id, grantedRoleKeys: ['manager'], membershipRevision: 'v1' },
  'finance.daily_summary.ready': { snapshotId: id, localDate: '2026-10-03', currency: 'PEN' },
  'stock.daily_summary.ready': { snapshotId: id, localDate: '2026-10-03' },
  'release.product.published': {
    releaseId: id,
    version: 'v1.2.0',
    releaseClass: 'minor',
    artifactDigest: 'a'.repeat(64),
    publicationReceiptId: other,
    publishedAt: instant,
  },
  'release.gateway.available': {
    releaseId: id,
    version: 'v1.2.0',
    artifactDigest: 'a'.repeat(64),
    publicationReceiptId: other,
    publishedAt: instant,
    feedRevision: 'v1',
  },
  'automation.schedule.committed': {
    scheduleId: id,
    scheduleRevision: 'v1',
    ownerProfileId: other,
  },
  'automation.run.failed': { runId: id, ownerProfileId: other, failureClass: 'deadline_exceeded' },
  'automation.effects.committed': {
    runId: id,
    ownerProfileId: other,
    effectReceiptIds: [id, other],
  },
  'agent.user_notice': { snapshotId: id, recipientProfileId: other, authorProfileId: id },
  'agent.report.ready': { snapshotId: id, planId: other, planRevision: 'v1', slotId: id },
} satisfies Record<NotificationKind, unknown>;

describe('notification catalog', () => {
  it('rejects regenerated semantic metadata under an unchanged catalog revision', () => {
    const previous = notificationCatalogManifest();
    const changed = JSON.parse(previous) as {
      revision: string;
      kinds: Record<string, { template: string }>;
    };
    changed.kinds['join.requested'].template = 'changed.template';
    expect(() => assertNotificationCatalogRevision(previous, JSON.stringify(changed))).toThrow(
      'without a new revision',
    );
    changed.revision = '2026-10-03.2';
    expect(() =>
      assertNotificationCatalogRevision(previous, JSON.stringify(changed)),
    ).not.toThrow();
  });
  for (const kind of NOTIFICATION_KINDS) {
    it(`admits ${kind} and rejects missing, extra and malformed fields`, () => {
      const input = examples[kind];
      const result = parseNotificationPayload(kind, input);
      expect(result.payload).toEqual(input);
      expect(parseEncodedNotificationPayload(kind, result.canonical)).toEqual(result);
      expect(result.payload).not.toBe(input);
      for (const key of Object.keys(input)) {
        const missing: Record<string, unknown> = { ...input };
        delete missing[key];
        expect(() => parseNotificationPayload(kind, missing)).toThrow(NotificationInputError);
        expect(() => parseNotificationPayload(kind, { ...input, [key]: 42 })).toThrow(
          NotificationInputError,
        );
      }
      expect(() =>
        parseNotificationPayload(kind, { ...input, secret: 'received-private-value' }),
      ).toThrow(NotificationInputError);
    });
  }

  it('rejects unavailable versions and adapters without pretending a kind is wired', () => {
    expect(() => parseNotificationPayload('join.requested', examples['join.requested'], 2)).toThrow(
      'unsupported_version',
    );
    expect(() =>
      parseNotificationPayload('join.requested', examples['join.requested'], 1, 'future'),
    ).toThrow('unsupported_version');
    expect(notificationSettingsCatalog()).toHaveLength(16);
    for (const publicKind of notificationSettingsCatalog()) {
      expect(publicKind.available).toBe(false);
      expect(Object.keys(publicKind).sort()).toEqual([
        'available',
        'catalogRevision',
        'kind',
        'schemaVersion',
        'template',
      ]);
      expect(() => requireNotificationAdapter(publicKind.kind)).toThrow('unsupported_version');
    }
  });

  it('binds semantic policy capabilities to the actual RBAC module and action inventory', () => {
    const source = ts.createSourceFile(
      'rbac.service.ts',
      readFileSync(new URL('../../server/services/rbac.service.ts', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const arrays = new Map<string, string[]>();
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        ['MODULES', 'ACTIONS'].includes(node.name.text)
      ) {
        const initializer = node.initializer;
        const value =
          initializer && ts.isAsExpression(initializer) ? initializer.expression : initializer;
        if (
          !value ||
          !ts.isArrayLiteralExpression(value) ||
          value.elements.some((element) => !ts.isStringLiteral(element))
        ) {
          throw new Error('RBAC inventory extraction requires its real literal array');
        }
        arrays.set(
          node.name.text,
          value.elements.map((element) => (element as ts.StringLiteral).text),
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect([...arrays.keys()].sort()).toEqual(['ACTIONS', 'MODULES']);
    for (const policy of Object.values(NOTIFICATION_POLICY_CONTRACTS)) {
      const capabilities: string[] = [
        policy.currentCapability,
        ...('producerCapability' in policy ? [policy.producerCapability] : []),
      ].filter((value): value is NonNullable<typeof value> => value !== null);
      for (const capability of capabilities) {
        const parts = capability.split(':');
        expect(parts).toHaveLength(2);
        expect(arrays.get('MODULES')).toContain(parts[0]);
        expect(arrays.get('ACTIONS')).toContain(parts[1]);
      }
    }
  });

  it('requires catalog changes to update the frozen reviewed revision and manifest digest', () => {
    const frozen = readFileSync(new URL('./catalog.manifest.json', import.meta.url), 'utf8');
    expect(notificationCatalogManifest()).toBe(frozen);
    const receipt = JSON.parse(
      readFileSync(new URL('./catalog.revision.json', import.meta.url), 'utf8'),
    ) as { revision: string; sha256: string };
    expect(receipt.revision).toBe(NOTIFICATION_CATALOG_REVISION);
    expect(createHash('sha256').update(frozen).digest('hex')).toBe(receipt.sha256);
    expect(Object.keys(examples).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it('tracks actual booking UI and service statuses, including their source declarations', () => {
    expect([...BOOKING_STATUS_VALUES].sort()).toEqual([...BOOKING_STATUSES].sort());
    const file = ts.createSourceFile(
      'scheduling-bookings.service.ts',
      readFileSync(
        new URL('../../server/services/scheduling-bookings.service.ts', import.meta.url),
        'utf8',
      ),
      ts.ScriptTarget.Latest,
      true,
    );
    let actual: string[] | undefined;
    function visit(node: ts.Node): void {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'SETTABLE'
      ) {
        const init = node.initializer;
        if (
          !init ||
          !ts.isNewExpression(init) ||
          !ts.isIdentifier(init.expression) ||
          init.expression.text !== 'Set' ||
          !init.arguments ||
          init.arguments.length !== 1 ||
          !ts.isArrayLiteralExpression(init.arguments[0])
        )
          throw Error('Review changed status owner');
        actual = init.arguments[0].elements.map((item) => {
          if (!ts.isStringLiteral(item)) throw Error('Review dynamic statuses');
          return item.text;
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(actual).toBeDefined();
    expect(actual?.sort()).toEqual([...BOOKING_STATUS_VALUES].sort());
  });

  it('rejects no-op transitions, unpublished release classes and non-tangible effects', () => {
    expect(() =>
      parseNotificationPayload('domain.status.changed', {
        ...examples['domain.status.changed'],
        toStatus: 'pending',
      }),
    ).toThrow('invalid_field');
    expect(() =>
      parseNotificationPayload('domain.status.changed', {
        ...examples['domain.status.changed'],
        adapter: 'arbitrary.sql',
      }),
    ).toThrow('invalid_field');
    for (const releaseClass of ['patch', 'draft'])
      expect(() =>
        parseNotificationPayload('release.product.published', {
          ...examples['release.product.published'],
          releaseClass,
        }),
      ).toThrow('invalid_field');
    for (const effectReceiptIds of [[], [id, id], Array(129).fill(id)])
      expect(() =>
        parseNotificationPayload('automation.effects.committed', {
          ...examples['automation.effects.committed'],
          effectReceiptIds,
        }),
      ).toThrow(NotificationInputError);
  });

  it('rejects impossible calendar dates, noncanonical instants and uppercase UUIDs', () => {
    for (const localDate of ['2026-02-29', '2026-04-31', '2026-13-01'])
      expect(() =>
        parseNotificationPayload('finance.daily_summary.ready', {
          ...examples['finance.daily_summary.ready'],
          localDate,
        }),
      ).toThrow('invalid_field');
    expect(() =>
      parseNotificationPayload('join.approved', {
        ...examples['join.approved'],
        decidedAt: '2026-10-03T10:00:00-05:00',
      }),
    ).toThrow('invalid_field');
    expect(() =>
      parseNotificationPayload('join.requested', {
        requestId: 'AAAAAAAA-1111-4111-8111-111111111111',
        applicantProfileId: id,
      }),
    ).toThrow('invalid_field');
  });
});

describe('notification object and byte admission', () => {
  it('measures canonical UTF-8 bytes at the exact boundary independently of smaller kind schemas', () => {
    const valid = 'x'.repeat(NOTIFICATION_PAYLOAD_LIMIT - 2);
    expect(new TextEncoder().encode(canonicalNotificationPayload(valid))).toHaveLength(
      NOTIFICATION_PAYLOAD_LIMIT,
    );
    expect(() => canonicalNotificationPayload(valid + 'x')).toThrow('input_too_large');
    expect(canonicalNotificationPayload('é'.repeat(16383))).toHaveLength(16385);
    expect(() => canonicalNotificationPayload('é'.repeat(16384))).toThrow('input_too_large');
    expect(() => decodeNotificationPayload(' '.repeat(NOTIFICATION_PAYLOAD_LIMIT + 1))).toThrow(
      'input_too_large',
    );
    expect(() => decodeNotificationPayload('é'.repeat(16385))).toThrow('input_too_large');
  });

  it('never executes getters or toJSON and rejects cycles, nonplain objects, symbols and sparse arrays', () => {
    const getter = vi.fn(() => id),
      toJSON = vi.fn(() => ({ requestId: id }));
    const accessor = Object.defineProperty({}, 'requestId', { enumerable: true, get: getter });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      accessor,
      { toJSON },
      cyclic,
      new Date(),
      new Map(),
      { [Symbol('secret')]: id },
      Array(2),
      [undefined],
      NaN,
      Infinity,
      1n,
    ])
      expect(() => canonicalNotificationPayload(value)).toThrow(NotificationInputError);
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('bounds depth, nodes and collections, rejects lone surrogates and sorts keys', () => {
    expect(canonicalNotificationPayload({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    );
    for (const value of [
      '\ud800',
      '\udfff',
      { ['\ud800']: 1 },
      Array(129).fill(0),
      Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['key' + i, 0])),
      [[[[[[[0]]]]]]],
      Array.from({ length: 5 }, () => Array(128).fill(0)),
    ])
      expect(() => canonicalNotificationPayload(value)).toThrow(NotificationInputError);
    expect(canonicalNotificationPayload('😀')).toBe('"😀"');
  });

  it('returns fixed errors without attacker-controlled values or key paths', () => {
    try {
      parseNotificationPayload('join.requested', { 'very-secret@example.invalid': 'token-value' });
      throw Error('unexpected accept');
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationInputError);
      expect(JSON.stringify(error)).not.toContain('secret');
      expect(JSON.stringify(error)).not.toContain('token-value');
    }
  });
});
