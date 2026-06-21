// Framework-free NDJSON reader for the artifact builder stream. No runes, so
// it's trivially testable. Mirrors the server framing in build-stream.ts.

export type BuildProgress = { phase: 'generating' | 'repairing'; attempt: number; max: number };

/**
 * Drains a builder NDJSON response, calling `onProgress` for each progress
 * line and returning the terminal artifact. Throws on the terminal error line.
 */
export async function readBuildStream<T = unknown>(
  res: Response,
  onProgress: (p: BuildProgress) => void,
): Promise<T> {
  if (!res.body) throw new Error('response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  let done = false;

  while (!done) {
    const { done: streamDone, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (streamDone) buffer += decoder.decode();

    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let obj: { done?: boolean; error?: string; artifact?: T } & Partial<BuildProgress>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.done) {
        if (obj.error) throw new Error(obj.error);
        result = obj.artifact;
        done = true;
        break;
      }
      if (obj.phase) onProgress(obj as BuildProgress);
    }
    if (streamDone) break;
  }

  if (result === undefined) throw new Error('build stream ended without a result');
  return result;
}
