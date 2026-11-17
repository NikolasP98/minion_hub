import { describe, expect, it } from 'vitest';
import { parseRepostArgs } from './faces-garment-repost-2026-11';
import { CliAdmissionError } from './faces-stock-reconcile-2026-11';

const ORG = '00000000-0000-4000-8000-000000000001';
const H = 'a'.repeat(64);
const base = ['--org', ORG, '--manifest', 'm', '--output', 'o'];
describe('garment repost CLI flag grammar', () => {
  it('accepts preview, draft, apply and status', () => {
    expect(parseRepostArgs(base).mode).toBe('preview');
    expect(parseRepostArgs([...base, '--draft']).mode).toBe('draft');
    expect(
      parseRepostArgs([...base, '--apply', '--approved-plan-sha256', H, '--preview-hash', H]).mode,
    ).toBe('apply');
    expect(
      parseRepostArgs([...base, '--status', '--operation-key', ORG, '--manifest-sha256', H]).mode,
    ).toBe('status');
  });
  it.each([
    ['no batch flag exists', ['--batch']],
    ['apply needs both digests', ['--apply', '--preview-hash', H]],
    ['apply and status together', ['--apply', '--status']],
    ['status flags without status', ['--operation-key', ORG]],
    ['bad digest', ['--apply', '--approved-plan-sha256', 'x', '--preview-hash', H]],
  ])('refuses %s', (_n, extra) =>
    expect(() => parseRepostArgs([...base, ...(extra as string[])])).toThrow(CliAdmissionError),
  );
});
