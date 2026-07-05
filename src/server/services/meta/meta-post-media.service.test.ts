import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  pendingStatus,
  sanitizeError,
  recordPostMedia,
  claimPendingMedia,
  markMirrored,
  markFailed,
} from './meta-post-media.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('pendingStatus', () => {
  it('is pending when a preview url is present', () => {
    expect(pendingStatus('https://cdn.example/pic.jpg')).toBe('pending');
  });
  it('is skipped for a text-only post (no preview url)', () => {
    expect(pendingStatus(null)).toBe('skipped');
  });
});

describe('sanitizeError', () => {
  it('redacts query-string params (Meta CDN urls carry signature/token params)', () => {
    const msg = sanitizeError(new Error('403 https://fbcdn.net/pic.jpg?oe=abc&_nc_ohc=xyz&ccb=1'));
    expect(msg).not.toContain('_nc_ohc');
    expect(msg).not.toContain('oe=abc');
    expect(msg).toContain('?[redacted]');
  });
  it('caps length', () => {
    expect(sanitizeError(new Error('x'.repeat(1000))).length).toBeLessThanOrEqual(300);
  });
  it('stringifies a non-Error value', () => {
    expect(sanitizeError('plain string failure')).toBe('plain string failure');
  });
});

describe('recordPostMedia', () => {
  it('upserts a row via db.insert', async () => {
    const { db } = createMockDb();
    await recordPostMedia(ctx(db), { orgId: 'org-1', platform: 'fb', postId: 'post-1', sourceUrl: 'https://cdn/x.jpg', mediaType: null });
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('claimPendingMedia', () => {
  it('returns rows still needing a mirror attempt', async () => {
    const rows = [{ orgId: 'org-1', platform: 'fb', postId: 'post-1', status: 'pending' }];
    const { db, resolve } = createMockDb();
    resolve(rows);
    const claimed = await claimPendingMedia(ctx(db), 'org-1', 10);
    expect(db.select).toHaveBeenCalled();
    expect(claimed).toEqual(rows);
  });
});

describe('markMirrored / markFailed', () => {
  it('markMirrored updates the row', async () => {
    const { db } = createMockDb();
    await markMirrored(ctx(db), 'org-1', 'fb', 'post-1', 'file-1');
    expect(db.update).toHaveBeenCalled();
  });

  it('markFailed updates the row', async () => {
    const { db } = createMockDb();
    await markFailed(ctx(db), 'org-1', 'fb', 'post-1', new Error('boom'));
    expect(db.update).toHaveBeenCalled();
  });
});
