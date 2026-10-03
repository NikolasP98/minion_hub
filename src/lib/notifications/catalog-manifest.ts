import { NOTIFICATION_POLICY_CONTRACTS } from './policy-contracts';
import { NOTIFICATION_CATALOG, NOTIFICATION_CATALOG_REVISION, NOTIFICATION_KINDS } from './catalog';

/** Only the finite, frozen local registry enters this serializer, never event input. */
export function notificationCatalogManifest(): string {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, field]) => [key, ordered(field)]),
      );
    }
    return value;
  }
  return (
    JSON.stringify(
      ordered({
        revision: NOTIFICATION_CATALOG_REVISION,
        policies: NOTIFICATION_POLICY_CONTRACTS,
        kinds: Object.fromEntries(
          NOTIFICATION_KINDS.map((kind) => [kind, NOTIFICATION_CATALOG[kind]]),
        ),
      }),
      null,
      2,
    ) + '\n'
  );
}

export function assertNotificationCatalogRevision(previous: string, current: string): void {
  if (previous === current) return;
  const before = JSON.parse(previous) as { revision?: unknown };
  const after = JSON.parse(current) as { revision?: unknown };
  if (
    typeof before.revision !== 'string' ||
    typeof after.revision !== 'string' ||
    before.revision === after.revision
  ) {
    throw new Error('Notification catalog semantics changed without a new revision');
  }
}
