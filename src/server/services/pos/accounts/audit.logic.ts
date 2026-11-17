import { createHash } from 'node:crypto';
import type { AuditControl, AuditInterval } from './audit.types';

const SAMPLE = 100;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Real Gregorian date check (rejects 2026-02-30 and locale strings). */
export function isRealDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Validates one interval: real dates, after < before when both finite. Throws a credential-free message. */
export function assertInterval(interval: AuditInterval, label: string): void {
  for (const bound of [interval.after, interval.before]) {
    if (bound !== null && !isRealDate(bound)) throw new Error(`${label}: invalid date`);
  }
  if (interval.after !== null && interval.before !== null && interval.after >= interval.before) {
    throw new Error(`${label}: empty or inverted interval`);
  }
}

/** True when `inner` lies inside `outer` (null = unbounded). Widening is refused by the caller, never clamped. */
export function intervalContained(inner: AuditInterval, outer: AuditInterval): boolean {
  const lowerOk = outer.after === null || (inner.after !== null && inner.after >= outer.after);
  const upperOk = outer.before === null || (inner.before !== null && inner.before <= outer.before);
  return lowerOk && upperOk;
}

/** Streaming control accumulator: ids must arrive in ascending order; keeps a 100-id sample and a running hash. */
export class ControlAccumulator {
  private count = 0;
  private cohort = 0;
  private sample: string[] = [];
  private hash = createHash('sha256');
  private last: string | null = null;

  add(id: string, inCohort: boolean): void {
    if (this.last !== null && id <= this.last)
      throw new Error('control ids must be strictly ascending');
    this.last = id;
    this.hash.update(this.count === 0 ? id : `\n${id}`);
    this.count += 1;
    if (inCohort) this.cohort += 1;
    if (this.sample.length < SAMPLE) this.sample.push(id);
  }

  finish(): AuditControl {
    return {
      count: this.count,
      cohortCount: this.cohort,
      complementCount: this.count - this.cohort,
      sampleIds: this.sample,
      idsSha256: this.hash.digest('hex'),
    };
  }
}
