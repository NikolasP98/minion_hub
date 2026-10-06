import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATALOG, NOTIFICATION_CATALOG_REVISION } from './catalog';
import {
  canonicalNotificationProjectionSupport,
  NOTIFICATION_PROJECTION_SUPPORT,
  NOTIFICATION_PROJECTION_TEMPLATES,
  notificationProjectionManifest,
} from './projection-manifest';

/**
 * Independent oracle for `row(catalog_revision collate "C", kind collate "C", schema_version)`:
 * byte order on the two text fields, numeric order on the integer column.
 */
function sqlRowOrder(
  left: { catalogRevision: string; kind: string; schemaVersion: number },
  right: { catalogRevision: string; kind: string; schemaVersion: number },
): number {
  return (
    Buffer.compare(
      Buffer.from(left.catalogRevision, 'utf8'),
      Buffer.from(right.catalogRevision, 'utf8'),
    ) ||
    Buffer.compare(Buffer.from(left.kind, 'utf8'), Buffer.from(right.kind, 'utf8')) ||
    Math.sign(left.schemaVersion - right.schemaVersion)
  );
}

describe('notification projection manifest', () => {
  it('owns three unique current catalog tuples in canonical order', () => {
    const keys = NOTIFICATION_PROJECTION_SUPPORT.map(
      ({ catalogRevision, kind, schemaVersion }) => `${catalogRevision}\0${kind}\0${schemaVersion}`,
    );
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(3);
    for (const support of NOTIFICATION_PROJECTION_SUPPORT) {
      expect(support.catalogRevision).toBe(NOTIFICATION_CATALOG_REVISION);
      expect(NOTIFICATION_CATALOG[support.kind].schemaVersion).toBe(support.schemaVersion);
    }
  });

  it('orders the shipped manifest exactly like the SQL row comparison', () => {
    const canonical = canonicalNotificationProjectionSupport(NOTIFICATION_PROJECTION_SUPPORT);
    expect(canonical.map((v) => v.kind)).toEqual(
      NOTIFICATION_PROJECTION_SUPPORT.map((v) => v.kind),
    );
    expect(canonical).toEqual([...canonical].sort(sqlRowOrder));
  });

  it('orders schema versions numerically, never as stringified text', () => {
    // The complement ranges in `unsupportedProjectionPending` compare schema_version as an
    // integer. A joined-string sort puts "10" before "2" and inverts the gap, so an unsupported
    // pending row between them would fall into no range and be reported as drained.
    const canonical = canonicalNotificationProjectionSupport([
      { catalogRevision: 'r1', kind: 'join.requested', schemaVersion: 10, adapterRevision: 'a.v1' },
      { catalogRevision: 'r1', kind: 'join.requested', schemaVersion: 2, adapterRevision: 'a.v1' },
    ]);
    expect(canonical.map((v) => v.schemaVersion)).toEqual([2, 10]);
    expect(canonical).toEqual([...canonical].sort(sqlRowOrder));
  });

  it('orders punctuated routing fields by byte order, not locale collation', () => {
    // The catalogRevision regex admits '_' and ':', which sort AFTER digits in byte order
    // (0x5F and 0x3A vs 0x31) while a locale collation ranks them before. collate "C" is what the
    // complement ranges use, so byte order is the only correct answer here.
    const canonical = canonicalNotificationProjectionSupport([
      {
        catalogRevision: 'rev_1',
        kind: 'join.requested',
        schemaVersion: 1,
        adapterRevision: 'join-requested.v1',
      },
      {
        catalogRevision: 'rev1',
        kind: 'join.requested',
        schemaVersion: 1,
        adapterRevision: 'join-requested.v1',
      },
    ]);
    expect(canonical).toEqual([...canonical].sort(sqlRowOrder));
    expect(canonical.map((v) => v.catalogRevision)).toEqual(['rev1', 'rev_1']);
    // Guard the premise: a locale collation really does disagree on this pair.
    expect(Math.sign('rev_1'.localeCompare('rev1', 'en-US'))).not.toBe(
      Math.sign(Buffer.compare(Buffer.from('rev_1'), Buffer.from('rev1'))),
    );
  });

  it('binds immutable template bytes to their checked digests', () => {
    for (const template of Object.values(NOTIFICATION_PROJECTION_TEMPLATES)) {
      expect(createHash('sha256').update(template.bytes).digest('hex')).toBe(template.sha256);
      expect(Buffer.byteLength(template.bytes)).toBeLessThanOrEqual(8192);
      expect(template.maximumRenderedBytes).toBeLessThanOrEqual(8192);
    }
    expect(notificationProjectionManifest()).toMatch(/^\{"projectionKind":"inbox\.v1",/);
  });
});
