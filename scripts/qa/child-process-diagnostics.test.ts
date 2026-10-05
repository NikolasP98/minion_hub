import { describe, expect, it } from 'vitest';
import {
  CHILD_STREAM_DIAGNOSTIC_LIMIT_BYTES,
  childProcessOutcome,
  formatChildProcessFailure,
} from './child-process-diagnostics';

describe('QA child process diagnostics', () => {
  it('keeps the JSON stdout channel available while bounding child diagnostics per stream', () => {
    const prefix = 'discard-me:';
    const stderr = prefix + 'x'.repeat(CHILD_STREAM_DIAGNOSTIC_LIMIT_BYTES) + '\nroot cause\n';
    const formatted = formatChildProcessFailure('scripts/db-migrate.ts', {
      error: undefined,
      signal: null,
      status: 1,
      stdout: 'db:migrate — applying 20261003140000\n',
      stderr,
    });

    expect(formatted).toContain('scripts/db-migrate.ts failed (exit=1)');
    expect(formatted).toContain('[child stdout]');
    expect(formatted).toContain('db:migrate — applying 20261003140000');
    expect(formatted).toContain('[child stderr; truncated ');
    expect(formatted).not.toContain(prefix);
    expect(formatted).toContain('root cause');
    expect(Buffer.byteLength(formatted, 'utf8')).toBeLessThan(
      CHILD_STREAM_DIAGNOSTIC_LIMIT_BYTES * 2,
    );
  });

  it('classifies spawn errors and signals without treating them as an ordinary exit', () => {
    const spawnError = Object.assign(new Error('missing executable'), { code: 'ENOENT' });
    expect(
      childProcessOutcome({
        error: spawnError,
        signal: null,
        status: null,
        stdout: '',
        stderr: '',
      }),
    ).toBe('spawn-error=ENOENT');
    expect(
      childProcessOutcome({
        error: undefined,
        signal: 'SIGTERM',
        status: null,
        stdout: '',
        stderr: '',
      }),
    ).toBe('signal=SIGTERM');
  });

  it.each([1, 2])(
    'advances a tail starting after byte %i of a four-byte scalar before decoding',
    (splitAfterBytes) => {
      const prefix = 'discard-me:';
      const rootCause = '\nroot cause: migration failed\n';
      const suffixBytes = CHILD_STREAM_DIAGNOSTIC_LIMIT_BYTES - 4 + splitAfterBytes;
      const padding = 'x'.repeat(suffixBytes - Buffer.byteLength(rootCause));
      const formatted = formatChildProcessFailure('scripts/db-migrate.ts', {
        error: undefined,
        signal: null,
        status: 1,
        stdout: '',
        stderr: `${prefix}🧪${padding}${rootCause}`,
      });
      const outcomeEnd = formatted.indexOf('\n');
      const markerEnd = formatted.indexOf('\n', outcomeEnd + 1);
      const retainedTail = formatted.slice(markerEnd + 1);

      expect(formatted).toContain('[child stderr; truncated ');
      expect(formatted).not.toContain(prefix);
      expect(retainedTail).not.toContain('\uFFFD');
      expect(retainedTail).toContain('root cause: migration failed');
      expect(Buffer.byteLength(retainedTail, 'utf8')).toBeLessThanOrEqual(
        CHILD_STREAM_DIAGNOSTIC_LIMIT_BYTES,
      );
    },
  );
});
