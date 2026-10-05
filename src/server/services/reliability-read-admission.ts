const MAX_ACTIVE = 4;
const DEADLINE_MS = 15_000;

let activeTotal = 0;
const activeByOwnerTarget = new Map<string, number>();

export class ReliabilityReadAdmissionError extends Error {
  constructor(
    readonly status: 503 | 504,
    readonly code: 'reliability_read_busy' | 'reliability_read_timeout',
  ) {
    super('Reliability data is temporarily unavailable');
    this.name = 'ReliabilityReadAdmissionError';
  }
}

function release(key: string): void {
  activeTotal = Math.max(0, activeTotal - 1);
  releaseOwnerTarget(key);
}

function releaseOwnerTarget(key: string): void {
  const next = (activeByOwnerTarget.get(key) ?? 1) - 1;
  if (next > 0) activeByOwnerTarget.set(key, next);
  else activeByOwnerTarget.delete(key);
}

/**
 * Reject instead of queueing. If the HTTP deadline wins, ownership stays held
 * until the underlying database/probe work actually settles.
 */
export async function withReliabilityReadAdmission<T>(
  ownerTargetKey: string,
  work: (signal: AbortSignal, rekey: (canonicalOwnerTargetKey: string) => void) => Promise<T>,
  deadlineMs = DEADLINE_MS,
): Promise<T> {
  if (activeTotal >= MAX_ACTIVE || (activeByOwnerTarget.get(ownerTargetKey) ?? 0) >= 1) {
    throw new ReliabilityReadAdmissionError(503, 'reliability_read_busy');
  }
  activeTotal++;
  activeByOwnerTarget.set(ownerTargetKey, 1);
  let activeKey = ownerTargetKey;
  let released = false;
  const controller = new AbortController();
  const rekey = (canonicalOwnerTargetKey: string) => {
    if (canonicalOwnerTargetKey === activeKey) return;
    if ((activeByOwnerTarget.get(canonicalOwnerTargetKey) ?? 0) >= 1) {
      throw new ReliabilityReadAdmissionError(503, 'reliability_read_busy');
    }
    releaseOwnerTarget(activeKey);
    activeByOwnerTarget.set(canonicalOwnerTargetKey, 1);
    activeKey = canonicalOwnerTargetKey;
  };
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release(activeKey);
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const underlying = Promise.resolve().then(() => work(controller.signal, rekey));
  underlying.then(releaseOnce, releaseOnce);
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ReliabilityReadAdmissionError(504, 'reliability_read_timeout'));
    }, deadlineMs);
  });
  try {
    return await Promise.race([underlying, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function reliabilityReadAdmissionSnapshot(): {
  activeTotal: number;
  activeKeys: number;
} {
  return { activeTotal, activeKeys: activeByOwnerTarget.size };
}
