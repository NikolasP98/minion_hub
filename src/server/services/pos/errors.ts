import type { StockShortfallLine } from '../pos.service';

/** One runtime identity for domain errors, independent of database services. */
export class PosError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** Stock detail lets callers localize a refusal without parsing its message. */
    readonly items?: StockShortfallLine[],
  ) {
    super(message);
    this.name = 'PosError';
  }
}
