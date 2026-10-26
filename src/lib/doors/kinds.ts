import type { ZodType } from 'zod';
import type { DoorKind } from './types';

/**
 * Isomorphic kind registry. A kind slice adds `src/lib/doors/kinds/<kind>.ts`
 * exporting `kind`, `configSchema` and `defaultConfig` — nothing else to edit.
 */
export interface DoorKindModule {
  kind: DoorKind;
  configSchema: ZodType;
  defaultConfig: unknown;
}

const modules = import.meta.glob<DoorKindModule>(['./kinds/*.ts', '!./kinds/*.test.ts'], {
  eager: true,
});

const byKind = new Map<string, DoorKindModule>(
  Object.values(modules).map((mod) => [mod.kind, mod]),
);

export function getDoorKind(kind: string): DoorKindModule | undefined {
  return byKind.get(kind);
}

/** Kinds that can be created right now (registered modules only). */
export function registeredDoorKinds(): DoorKind[] {
  return [...byKind.keys()] as DoorKind[];
}
