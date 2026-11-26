/**
 * Wiring report (spec 150 FR-008): which filters publish which page values and,
 * per data block, which connections work and which do not. Pure and computed
 * from the FULL registry on the server, so the page, the assistant and MCP
 * agents all read the same answer and a block never shows unfiltered numbers
 * because a client-side catalog was RBAC-filtered or not loaded yet.
 *
 * Cross-element problems are reported, never refused at save, so blocks and
 * filters can be created in any order. A connection with a problem is ignored
 * until fixed (it is simply absent from `bindings`).
 */
import type { FilterControl, BlockSpec } from '$lib/sandbox/blocks/schema';
import type { ColumnType, Dataset } from './datasets';

export type WiringProblemCode = 'no_publisher' | 'kind_mismatch' | 'conflicting_publishers';

export interface WiringProblem {
  var: string;
  code: WiringProblemCode;
  detail: string;
}

export interface Publisher {
  var: string;
  control: FilterControl;
  /** Column type the value fits; null when a picker's choices column cannot be resolved. */
  colType: ColumnType | null;
  elementId: string;
  position: number;
}

export interface BlockWiring {
  /** Connections that work: the page applies exactly these. */
  bindings: Array<{ var: string; col: string }>;
  problems: WiringProblem[];
}

export interface WiringReport {
  publishers: Publisher[];
  /** Only data blocks that have connections. */
  blocks: Record<string, BlockWiring>;
  /** Same value name, same control and type: valid; the lowest position supplies the default. */
  duplicates: Array<{ var: string; elementIds: string[] }>;
}

export interface WiringElement {
  id: string;
  position: number;
  spec: BlockSpec | null;
}

function columnType(registry: readonly Dataset[], datasetId: string, col: string) {
  const column = registry.find((d) => d.id === datasetId)?.columns.find((c) => c.name === col);
  return column?.type ?? null;
}

const fits = (publisher: Publisher, blockType: ColumnType | null) =>
  blockType !== null && publisher.colType === blockType;

export function pageWiring(
  elements: readonly WiringElement[],
  registry: readonly Dataset[],
): WiringReport {
  const publishers: Publisher[] = [];
  for (const e of [...elements].sort((a, b) => a.position - b.position)) {
    if (e.spec?.type !== 'filter') continue;
    const { var: name, control, options } = e.spec;
    publishers.push({
      var: name,
      control,
      colType:
        control === 'date_range'
          ? 'timestamp'
          : options
            ? columnType(registry, options.dataset, options.col)
            : null,
      elementId: e.id,
      position: e.position,
    });
  }

  const byVar = new Map<string, Publisher[]>();
  for (const p of publishers) byVar.set(p.var, [...(byVar.get(p.var) ?? []), p]);

  const duplicates: WiringReport['duplicates'] = [];
  const conflicting = new Set<string>();
  for (const [name, list] of byVar) {
    if (list.length < 2) continue;
    const [first] = list;
    if (list.every((p) => p.control === first.control && p.colType === first.colType)) {
      duplicates.push({ var: name, elementIds: list.map((p) => p.elementId) });
    } else conflicting.add(name);
  }

  const blocks: WiringReport['blocks'] = {};
  for (const e of elements) {
    const spec = e.spec;
    if (!spec || spec.type === 'filter' || !spec.listens?.length) continue;
    const wiring: BlockWiring = { bindings: [], problems: [] };
    for (const { var: name, col } of spec.listens) {
      const list = byVar.get(name);
      if (!list) {
        wiring.problems.push({
          var: name,
          code: 'no_publisher',
          detail: `no filter publishes ${JSON.stringify(name)}`,
        });
      } else if (conflicting.has(name)) {
        wiring.problems.push({
          var: name,
          code: 'conflicting_publishers',
          detail: `filters sharing ${JSON.stringify(name)} differ in kind or column type`,
        });
      } else if (!fits(list[0], columnType(registry, spec.source.dataset, col))) {
        wiring.problems.push({
          var: name,
          code: 'kind_mismatch',
          detail: `a ${list[0].control} filter does not fit column ${JSON.stringify(col)}`,
        });
      } else wiring.bindings.push({ var: name, col });
    }
    blocks[e.id] = wiring;
  }

  return { publishers, blocks, duplicates };
}
