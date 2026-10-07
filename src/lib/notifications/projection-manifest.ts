import type { NotificationKind } from './catalog';
import { canonicalNotificationPayload, utf8Bytes } from './canonical';

export const NOTIFICATION_PROJECTION_REVISION = 'audience-projection.1';
export const NOTIFICATION_PROJECTION_KIND = 'inbox.v1' as const;

export type NotificationProjectionSupport = Readonly<{
  catalogRevision: string;
  kind: NotificationKind;
  schemaVersion: number;
  adapterRevision: string;
}>;

export type NotificationTemplateKey = keyof typeof TEMPLATE_DEFINITIONS;
export type NotificationNavigationId =
  'join.review' | 'join.status.approved' | 'join.status.denied';

type TemplateDefinition = Readonly<{
  revision: '1';
  sha256: string;
  bytes: string;
  maximumRenderedBytes: number;
}>;

function template(bytes: string, sha256: string, maximumRenderedBytes: number): TemplateDefinition {
  if (
    canonicalNotificationPayload(JSON.parse(bytes)) !== bytes ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    utf8Bytes(bytes) > 8192 ||
    !Number.isInteger(maximumRenderedBytes) ||
    maximumRenderedBytes < 1 ||
    maximumRenderedBytes > 8192
  ) {
    throw new Error('Invalid notification projection template');
  }
  return Object.freeze({ revision: '1', sha256, bytes, maximumRenderedBytes });
}

/** Immutable authenticated template bytes. Copy changes require a new key and adapter revision. */
const TEMPLATE_DEFINITIONS = Object.freeze({
  'join.approved.applicant.v1': template(
    '{"locales":{"en":{"summary":"Your request to join the organization was approved.","title":"Request approved"},"es":{"summary":"Tu solicitud para unirte a la organización fue aprobada.","title":"Solicitud aprobada"}},"revision":"1"}',
    '261f94d3d867b51ce44f3f383d1d194a62cecc80cbf41df02a523ec79b5338c1',
    59,
  ),
  'join.approved.manager.v1': template(
    '{"locales":{"en":{"summary":"A join request was approved.","title":"Join request approved"},"es":{"summary":"Se aprobó una solicitud de ingreso.","title":"Solicitud de ingreso aprobada"}},"revision":"1"}',
    '7a45a158d9a657ba2b6d950e105986abf95ddbc32b29695e7925563db389c1ee',
    69,
  ),
  'join.denied.applicant.v1': template(
    '{"locales":{"en":{"summary":"Your request to join the organization was not approved.","title":"Request update"},"es":{"summary":"Tu solicitud para unirte a la organización no fue aprobada.","title":"Actualización de solicitud"}},"revision":"1"}',
    '66c3581375ddb0879c3bd4c5e10509637f3dda7a848c140ab865bf2ac0474184',
    70,
  ),
  'join.denied.manager.v1': template(
    '{"locales":{"en":{"summary":"A join request was denied.","title":"Join request denied"},"es":{"summary":"Se denegó una solicitud de ingreso.","title":"Solicitud de ingreso denegada"}},"revision":"1"}',
    '36d62c40229a09b6c131d4d78407771f13055637e0f03262d59e049bfc6364c9',
    69,
  ),
  'join.requested.manager.v1': template(
    '{"locales":{"en":{"summary":"Review a pending request to join your organization.","title":"New join request"},"es":{"summary":"Revisa una solicitud pendiente para unirse a tu organización.","title":"Nueva solicitud de ingreso"}},"revision":"1"}',
    '6c916725a1ab5be2d68d037a859b569b7d4e3b634ec22ef3aa352df027b603a4',
    84,
  ),
});

export const NOTIFICATION_PROJECTION_TEMPLATES: Readonly<
  Record<NotificationTemplateKey, TemplateDefinition>
> = TEMPLATE_DEFINITIONS;

/** Canonical tuple order is also the PostgreSQL index/claim order. */
export const NOTIFICATION_PROJECTION_SUPPORT = Object.freeze([
  Object.freeze({
    catalogRevision: '2026-10-03.1',
    kind: 'join.approved',
    schemaVersion: 1,
    adapterRevision: 'join-outcome.v1',
  }),
  Object.freeze({
    catalogRevision: '2026-10-03.1',
    kind: 'join.denied',
    schemaVersion: 1,
    adapterRevision: 'join-outcome.v1',
  }),
  Object.freeze({
    catalogRevision: '2026-10-03.1',
    kind: 'join.requested',
    schemaVersion: 1,
    adapterRevision: 'join-requested.v1',
  }),
] satisfies readonly NotificationProjectionSupport[]);

export function notificationProjectionSupportKey(value: NotificationProjectionSupport): string {
  return `${value.catalogRevision}\0${value.kind}\0${value.schemaVersion}`;
}

/** Byte order over the ASCII-validated routing fields, matching PostgreSQL's C collation. */
function compareC(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalNotificationProjectionSupport(
  input: readonly NotificationProjectionSupport[],
): readonly NotificationProjectionSupport[] {
  if (input.length < 1 || input.length > 32)
    throw new Error('Invalid notification projection support');
  const result = input.map((value) => {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/.test(value.catalogRevision) ||
      !/^[a-z][a-z0-9_.]{0,95}$/.test(value.kind) ||
      !Number.isInteger(value.schemaVersion) ||
      value.schemaVersion < 1 ||
      value.schemaVersion > 65535 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/.test(value.adapterRevision)
    ) {
      throw new Error('Invalid notification projection support');
    }
    return Object.freeze({ ...value });
  });
  // Must order exactly like the SQL complement ranges in `unsupportedProjectionPending`:
  // `row(catalog_revision collate "C", kind collate "C", schema_version)`. The regexes above
  // restrict both text fields to ASCII, so code-unit order equals C collation; schemaVersion is
  // an integer column and must compare numerically. A locale collation over a joined key would
  // diverge on both counts: it treats the NUL field separator as ignorable, and it would order
  // stringified "10" before "2".
  result.sort(
    (left, right) =>
      compareC(left.catalogRevision, right.catalogRevision) ||
      compareC(left.kind, right.kind) ||
      left.schemaVersion - right.schemaVersion,
  );
  const routing = result.map(notificationProjectionSupportKey);
  if (new Set(routing).size !== result.length)
    throw new Error('Duplicate notification projection routing key');
  return Object.freeze(result);
}

export function notificationProjectionManifest(): string {
  return (
    canonicalNotificationPayload({
      projectionKind: NOTIFICATION_PROJECTION_KIND,
      revision: NOTIFICATION_PROJECTION_REVISION,
      support: NOTIFICATION_PROJECTION_SUPPORT.map((entry) => ({ ...entry })),
      templates: Object.fromEntries(
        Object.entries(NOTIFICATION_PROJECTION_TEMPLATES).map(([key, value]) => [
          key,
          {
            bytes: value.bytes,
            maximumRenderedBytes: value.maximumRenderedBytes,
            revision: value.revision,
            sha256: value.sha256,
          },
        ]),
      ),
    }) + '\n'
  );
}

export function notificationProjectionTemplate(key: NotificationTemplateKey): TemplateDefinition {
  return NOTIFICATION_PROJECTION_TEMPLATES[key];
}
