/**
 * Wire shape of the wiring report (spec 150). The report itself is computed on
 * the server (`$server/sandbox/wiring`); these types live here so the browser
 * host, the page and the agent tools can name it without importing server code.
 */
import type { FilterControl, PageValue } from './blocks/schema';

/** Mirrors the registry column types (`$server/sandbox/datasets`). */
export type WiringColumnType = 'text' | 'number' | 'timestamp' | 'boolean' | 'uuid';

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
  colType: WiringColumnType | null;
  elementId: string;
  position: number;
  /** The filter's saved default; with duplicates the lowest `position` wins. */
  default?: PageValue;
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
