import { afterEach, describe, expect, test, vi } from 'vitest';
import { ATTACHMENT_LIMITS } from './limits';
import { AttachmentUploadError, uploadAttachment } from './upload';

afterEach(() => vi.unstubAllGlobals());

function file(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(Math.min(sizeBytes, 1024))], name, { type });
}

describe('uploadAttachment — client pre-check', () => {
  test('rejects an oversized file before any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const big = file('big.pdf', 'application/pdf', ATTACHMENT_LIMITS.maxFileBytes + 1);
    Object.defineProperty(big, 'size', { value: ATTACHMENT_LIMITS.maxFileBytes + 1 });

    const err = await uploadAttachment(big, []).catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentUploadError);
    expect(err).toMatchObject({ code: 'too_large' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects a disallowed MIME type before any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const err = await uploadAttachment(file('script.sh', 'application/x-sh', 10), []).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AttachmentUploadError);
    expect(err).toMatchObject({ code: 'mime_not_allowed' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('uploadAttachment — server error mapping', () => {
  test('maps a 413 too_large response from /intent to a typed error with its code', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'file exceeds limit', code: 'too_large' }, { status: 413 }),
        ),
    );

    const err = await uploadAttachment(file('a.pdf', 'application/pdf', 10), []).catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentUploadError);
    expect(err).toMatchObject({ code: 'too_large', message: 'file exceeds limit' });
  });

  test('maps a 409 still_linked response from /finalize to a typed error with its code', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ fileId: 'f1', key: 'k', uploadUrl: 'http://up', maxBytes: 1 }),
        )
        .mockResolvedValueOnce(
          Response.json({ error: 'still linked', code: 'still_linked' }, { status: 409 }),
        ),
    );
    class FakeXHR {
      upload = { onprogress: null as ((e: unknown) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);

    const err = await uploadAttachment(file('a.pdf', 'application/pdf', 10), []).catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentUploadError);
    expect(err).toMatchObject({ code: 'still_linked', message: 'still linked' });
  });

  test('falls back to "unknown" when the server error has no code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message: 'nope' }, { status: 403 })),
    );

    const err = await uploadAttachment(file('a.pdf', 'application/pdf', 10), []).catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentUploadError);
    expect(err).toMatchObject({ code: 'unknown' });
  });
});

describe('uploadAttachment target propagation', () => {
  test.each([200, 500])(
    'retains real record targets through intent and upload transport status %i',
    async (status) => {
      const targets = [
        { objectType: 'booking' as const, objectId: '30000000-0000-4000-8000-000000000002' },
      ];
      const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/attachments/intent')
          return Response.json({
            fileId: 'intent',
            key: 'key',
            uploadUrl: 'http://fixture.invalid/put',
            maxBytes: 1000,
          });
        if (url === '/api/files') return Response.json({ ok: true, id: 'proxy' });
        if (url === '/api/attachments/finalize')
          return Response.json({ fileId: 'intent', sizeBytes: 10, links: targets });
        return Response.json({ ok: true });
      });
      vi.stubGlobal('fetch', fetchSpy);
      class XHR {
        upload = { onprogress: null };
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        status = status;
        open() {}
        setRequestHeader() {}
        send() {
          this.onload?.();
        }
      }
      vi.stubGlobal('XMLHttpRequest', XHR);
      await uploadAttachment(file('a.pdf', 'application/pdf', 10), targets);
      const intent = fetchSpy.mock.calls.find(([url]) => url === '/api/attachments/intent')!;
      expect(JSON.parse(intent[1]!.body as string).links).toEqual(targets);
      if (status === 500) {
        const proxy = fetchSpy.mock.calls.find(([url]) => url === '/api/files')!;
        expect(JSON.parse(String((proxy[1]!.body as FormData).get('links')))).toEqual(targets);
      } else {
        const finalize = fetchSpy.mock.calls.find(([url]) => url === '/api/attachments/finalize')!;
        expect(JSON.parse(finalize[1]!.body as string).links).toEqual(targets);
      }
    },
  );
});
