export const page = $state({
  status: 200,
  error: null,
  data: { permissions: { permissions: ['scheduling:edit'] } },
  url: new URL('http://fixture.invalid'),
});
export const transport = $state({
  writes: 0,
  reads: 0,
  nextReadFails: false,
  pending: false,
  unexpectedRequests: 0,
});
let resolveWrite: ((r: Response) => void) | undefined;
let rejectWrite: ((e: Error) => void) | undefined;
export function installTransport() {
  const originalFetch = globalThis.fetch;
  const fixtureFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), location.href);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const allowed =
      (url.pathname === '/api/scheduling/event-kinds' && method === 'POST') ||
      (/^\/api\/scheduling\/event-kinds\/[^/]+$/.test(url.pathname) &&
        (method === 'PATCH' || method === 'DELETE')) ||
      (/^\/api\/pulse\/proposals\/[^/]+$/.test(url.pathname) && method === 'PATCH');
    if (url.origin !== location.origin || url.search || !allowed || transport.pending) {
      transport.unexpectedRequests++;
      throw new Error('Unexpected or overlapping request in the mutation evidence fixture');
    }
    transport.writes++;
    transport.pending = true;
    return new Promise<Response>((resolve, reject) => {
      resolveWrite = resolve;
      rejectWrite = reject;
    });
  };
  globalThis.fetch = fixtureFetch;
  return () => {
    if (globalThis.fetch === fixtureFetch) globalThis.fetch = originalFetch;
    rejectWrite?.(new DOMException('Evidence fixture disposed', 'AbortError'));
    resolveWrite = undefined;
    rejectWrite = undefined;
    transport.pending = false;
  };
}
export function acknowledge() {
  const resolve = resolveWrite;
  if (!resolve || !transport.pending) throw new Error('No fixture write to acknowledge');
  resolveWrite = undefined;
  rejectWrite = undefined;
  transport.pending = false;
  resolve(new Response(null, { status: 200 }));
}
export function loseReply() {
  const reject = rejectWrite;
  if (!reject || !transport.pending) throw new Error('No fixture reply to lose');
  resolveWrite = undefined;
  rejectWrite = undefined;
  transport.pending = false;
  reject(new TypeError('Synthetic lost reply'));
}
