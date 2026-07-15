import { describe, expect, it } from 'vitest';
import { proxyRequestHeaders, proxyResponseHeaders, safeClientAddress } from './proxy-headers';

describe('proxyRequestHeaders', () => {
  it('removes hop-by-hop and explicitly omitted credentials', () => {
    const headers = proxyRequestHeaders(
      new Headers({
        authorization: 'Bearer hub-secret',
        connection: 'keep-alive',
        'content-length': '12',
        'content-type': 'application/json',
        cookie: 'hub-session=secret',
        host: 'localhost:5173',
        'transfer-encoding': 'chunked',
        'x-request-id': 'request-1',
      }),
      ['authorization', 'cookie'],
    );

    expect(Object.fromEntries(headers)).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'request-1',
    });
  });

  it('removes stale compression metadata from decompressed fetch responses', () => {
    const headers = proxyResponseHeaders(
      new Headers({
        'content-encoding': 'gzip',
        'content-length': '42',
        'content-type': 'application/javascript',
      }),
    );
    expect(Object.fromEntries(headers)).toEqual({
      'content-type': 'application/javascript',
    });
  });

  it('tolerates adapters that cannot determine a client address', () => {
    expect(
      safeClientAddress(null, () => {
        throw new Error('unavailable');
      }),
    ).toBeNull();
    expect(safeClientAddress('203.0.113.1', () => '127.0.0.1')).toBe('203.0.113.1');
  });
});
