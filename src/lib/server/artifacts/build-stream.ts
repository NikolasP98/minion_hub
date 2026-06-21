import type { BuildProgress } from './builder';

/**
 * Wrap a build that emits attempt-level progress into an NDJSON Response.
 * Progress lines: { phase, attempt, max }. Terminal line: { done: true, ... }.
 * Matches the house streaming idiom in /api/structured-stream.
 */
export function ndjsonBuild<T>(run: (emit: (p: BuildProgress) => void) => Promise<T>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const write = (o: unknown) => c.enqueue(encoder.encode(JSON.stringify(o) + '\n'));
      try {
        const artifact = await run((p) => write(p));
        write({ done: true, artifact });
      } catch (e) {
        write({ done: true, error: e instanceof Error ? e.message : 'build failed' });
      } finally {
        c.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
