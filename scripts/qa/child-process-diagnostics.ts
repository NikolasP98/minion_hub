import type { SpawnSyncReturns } from 'node:child_process';

export const CHILD_STREAM_DIAGNOSTIC_LIMIT_BYTES = 16 * 1024;

type ChildResult = Pick<
  SpawnSyncReturns<string>,
  'error' | 'signal' | 'status' | 'stderr' | 'stdout'
>;

export function childProcessOutcome(result: ChildResult): string {
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return `spawn-error=${code ?? result.error.name}`;
  }
  if (result.signal) return `signal=${result.signal}`;
  return `exit=${result.status ?? 'unknown'}`;
}

export function formatChildProcessFailure(label: string, result: ChildResult): string {
  const lines = [`${label} failed (${childProcessOutcome(result)})`];
  appendBoundedStream(lines, 'stdout', result.stdout);
  appendBoundedStream(lines, 'stderr', result.stderr);
  return lines.join('\n');
}

function appendBoundedStream(lines: string[], label: string, value: string | null): void {
  if (!value) return;
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= CHILD_STREAM_DIAGNOSTIC_LIMIT_BYTES) {
    lines.push(`[child ${label}]`, value.trimEnd());
    return;
  }

  let retainedOffset = bytes.byteLength - CHILD_STREAM_DIAGNOSTIC_LIMIT_BYTES;
  // If the byte budget starts inside a multibyte scalar, advance past every continuation byte
  // before decoding. This keeps valid Unicode without deleting a legitimate U+FFFD from the child.
  while (retainedOffset < bytes.byteLength && (bytes[retainedOffset]! & 0xc0) === 0x80) {
    retainedOffset += 1;
  }
  const retained = bytes.subarray(retainedOffset).toString('utf8').trimEnd();
  const retainedBytes = Buffer.byteLength(retained, 'utf8');
  lines.push(
    `[child ${label}; truncated ${bytes.byteLength - retainedBytes} leading bytes]`,
    retained,
  );
}
