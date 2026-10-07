// HC-043 fixture: deterministic alias directory so renderMention resolves `@ana` and `@luis`.
const ALIASES = new Map([
  ['ana', 'user-ana'],
  ['luis', 'user-luis'],
]);
export function useAliasDirectory(): void {}
export function getAliases(): ReadonlyMap<string, string> {
  return ALIASES;
}
