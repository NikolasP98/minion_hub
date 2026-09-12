import { describe, it, expect } from 'vitest';
import { AttachmentError } from '$server/services/attachments.service';
import { handleAttachmentError } from './_errors';

describe('handleAttachmentError', () => {
  it('returns 409 for still_linked', async () => {
    const res = handleAttachmentError(new AttachmentError('still_linked', 'nope'));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'nope', code: 'still_linked' });
  });

  it('returns 415 for mime_not_allowed', () => {
    expect(handleAttachmentError(new AttachmentError('mime_not_allowed', 'bad type')).status).toBe(
      415,
    );
  });

  it('returns 413 for too_large and quota_exceeded', () => {
    expect(handleAttachmentError(new AttachmentError('too_large', 'x')).status).toBe(413);
    expect(handleAttachmentError(new AttachmentError('quota_exceeded', 'x')).status).toBe(413);
  });

  it('returns 404 for not_found and upload_missing', () => {
    expect(handleAttachmentError(new AttachmentError('not_found', 'x')).status).toBe(404);
    expect(handleAttachmentError(new AttachmentError('upload_missing', 'x')).status).toBe(404);
  });

  it('re-throws non-AttachmentError untouched', () => {
    const boom = new Error('boom');
    expect(() => handleAttachmentError(boom)).toThrow(boom);
  });
});
