const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const;

/**
 * Copy request headers across an HTTP proxy boundary without forwarding
 * transport-specific values that Fetch/Undici must calculate itself.
 */
export function proxyRequestHeaders(source: Headers, omit: readonly string[] = []): Headers {
  const headers = new Headers(source);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  for (const name of omit) headers.delete(name);
  return headers;
}

/** Fetch transparently decompresses upstream bodies, so encoding and length
 * metadata from the compressed response must not be sent to the browser. */
export function proxyResponseHeaders(source: Headers): Headers {
  const headers = proxyRequestHeaders(source);
  headers.delete('content-encoding');
  return headers;
}

export function safeClientAddress(
  forwardedFor: string | null,
  getClientAddress: () => string,
): string | null {
  if (forwardedFor) return forwardedFor;
  try {
    return getClientAddress();
  } catch {
    return null;
  }
}
