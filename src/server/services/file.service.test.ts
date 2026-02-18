import { describe, it, expect, vi } from 'vitest';
import { uploadFile, getFileUrl, deleteFile } from './file.service';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-file-id-0000000001',
  nowMs: () => 1_700_000_000_000,
}));

const mockUploadToB2 = vi.fn<(k: string, b: Buffer | Uint8Array, ct: string) => Promise<void>>();
const mockGetSignedDownloadUrl = vi.fn<(k: string) => Promise<string>>().mockResolvedValue('https://signed-url.example.com/file');
const mockDeleteFromB2 = vi.fn<(k: string) => Promise<void>>();

vi.mock('$server/storage/b2', () => ({
  uploadToB2: (k: string, b: Buffer | Uint8Array, ct: string) => mockUploadToB2(k, b, ct),
  getSignedDownloadUrl: (k: string) => mockGetSignedDownloadUrl(k),
  deleteFromB2: (k: string) => mockDeleteFromB2(k),
}));

describe('uploadFile', () => {
  it('calls uploadToB2 and db.insert', async () => {
    const { db } = createMockDb();
    const id = await uploadFile(
      { db, tenantId: 't1' },
      { fileName: 'test.pdf', contentType: 'application/pdf', data: Buffer.from('hi') },
    );
    expect(id).toBe('mock-file-id-0000000001');
    expect(mockUploadToB2).toHaveBeenCalledWith(
      't1/general/mock-file-id-0000000001/test.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(db.insert).toHaveBeenCalled();
  });

  it('defaults category to general', async () => {
    const { db } = createMockDb();
    await uploadFile(
      { db, tenantId: 't1' },
      { fileName: 'x.txt', contentType: 'text/plain', data: Buffer.from('data') },
    );
    // Verify the b2FileKey includes 'general'
    expect(mockUploadToB2).toHaveBeenCalledWith(
      expect.stringContaining('/general/'),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('getFileUrl', () => {
  it('returns null when file not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // no rows
    const result = await getFileUrl({ db, tenantId: 't1' }, 'no-such-id');
    expect(result).toBe(null);
  });

  it('returns file with signed URL when found', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f1', b2FileKey: 'key', fileName: 'test.pdf' }]);
    const result = await getFileUrl({ db, tenantId: 't1' }, 'f1');
    expect(result).not.toBe(null);
    expect(result!.url).toBe('https://signed-url.example.com/file');
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith('key');
  });
});

describe('deleteFile', () => {
  it('does nothing when file not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // no rows
    mockDeleteFromB2.mockClear();
    await deleteFile({ db, tenantId: 't1' }, 'no-such-id');
    expect(mockDeleteFromB2).not.toHaveBeenCalled();
  });

  it('calls deleteFromB2 then db.delete when found', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ b2FileKey: 'some/key' }]);
    await deleteFile({ db, tenantId: 't1' }, 'f1');
    expect(mockDeleteFromB2).toHaveBeenCalledWith('some/key');
    expect(db.delete).toHaveBeenCalled();
  });
});
