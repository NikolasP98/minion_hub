// Framework-free SSE parsing for the flow runner. No Svelte runes here so it
// is trivially unit-testable; flow-editor.svelte.ts consumes this.

export type FlowRunEvent = {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  nodeId?: string;
};

/**
 * Reads an SSE byte stream and yields each `data:` payload as a FlowRunEvent.
 * Stops yielding when the terminal `event: done` frame is seen. Malformed
 * JSON payloads are skipped.
 */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<FlowRunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const isDone = frame.split('\n').some((l) => l === 'event: done');
        if (isDone) return;

        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const raw = dataLine.slice('data: '.length);
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.message === 'string') {
            yield parsed as FlowRunEvent;
          }
        } catch {
          // skip malformed frame
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
