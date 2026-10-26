import type { CoreCtx } from '$server/auth/core-ctx';
import type { DoorKind, DoorRow, PublicDoorData } from '$lib/doors/types';

/**
 * Server kind registry. A kind slice adds `src/server/doors/kinds/<kind>.server.ts`
 * exporting `kind` and `publicView` — the public-safe projection rendered at
 * `/d/<slug>` (no PII, no drafts).
 */
export interface ServerDoorKind {
  kind: DoorKind;
  publicView(ctx: CoreCtx, door: DoorRow): Promise<PublicDoorData>;
}

const modules = import.meta.glob<ServerDoorKind>(['./kinds/*.server.ts', '!./kinds/*.test.ts'], {
  eager: true,
});

const byKind = new Map<string, ServerDoorKind>(
  Object.values(modules).map((mod) => [mod.kind, mod]),
);

export function getServerDoorKind(kind: string): ServerDoorKind | undefined {
  return byKind.get(kind);
}
