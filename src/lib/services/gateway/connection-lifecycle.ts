import type { Host } from '$lib/types/host';

/** Small async-operation fence for connect/cutover work that crosses awaits. */
export class ConnectionLifecycleFence {
  private generation = 0;

  begin(): number {
    return ++this.generation;
  }

  snapshot(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  invalidate(): void {
    this.generation++;
  }
}

/** A backup is only a distinct candidate; successful hello proves viability. */
export function isDistinctCutoverTarget(source: Host | null, target: Host | null): target is Host {
  if (!source || !target || !target.url.trim() || source.id === target.id) return false;
  return normalizeUrl(source.url) !== normalizeUrl(target.url);
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}
