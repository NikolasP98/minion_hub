<script lang="ts">
  import type { SchemaType } from '$lib/schemas/structured-response';
  import ActionPlanStream from './ActionPlanStream.svelte';
  import SearchResultStream from './SearchResultStream.svelte';

  let {
    type,
    prompt,
    model,
    onStatusChange,
  }: {
    type: SchemaType;
    prompt: string;
    model?: string;
    /** Called with a status label derived from current partial field (debounced ≥ 300ms). */
    onStatusChange?: (status: string | null) => void;
  } = $props();

  type StreamLine =
    | { partial: Record<string, unknown>; done: false }
    | { partial: Record<string, unknown>; done: true }
    | { error: string; done: true };

  let partial = $state<Record<string, unknown> | null>(null);
  let done = $state(false);
  let streamError = $state<string | null>(null);
  let loading = $state(false);

  // Debounced status updates — keep timer ref in non-reactive var
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleStatusChange(label: string | null) {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      onStatusChange?.(label);
      statusTimer = null;
    }, 300);
  }

  function deriveStatusLabel(p: Record<string, unknown> | null): string | null {
    if (!p) return 'starting…';
    if (type === 'action_plan') {
      const steps = p.steps as Array<{ action?: string }> | undefined;
      if (!p.goal) return 'generating goal…';
      if (!steps?.length) return 'planning steps…';
      const last = steps[steps.length - 1];
      return last?.action ? `planning: ${last.action.slice(0, 40)}` : 'generating steps…';
    }
    if (type === 'search_results') {
      if (!p.query) return 'preparing query…';
      const results = p.results as Array<unknown> | undefined;
      return `finding results… (${results?.length ?? 0} so far)`;
    }
    if (type === 'calendar_summary') {
      if (!p.date) return 'reading calendar…';
      const events = p.events as Array<unknown> | undefined;
      return `summarising events… (${events?.length ?? 0} found)`;
    }
    return 'generating…';
  }

  async function startStream() {
    if (loading) return;
    loading = true;
    partial = null;
    done = false;
    streamError = null;
    scheduleStatusChange('starting…');

    try {
      const res = await fetch('/api/structured-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, prompt, model }),
      });

      if (!res.ok) {
        const text = await res.text();
        streamError = `Request failed (${res.status}): ${text}`;
        scheduleStatusChange(null);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        streamError = 'No response stream';
        scheduleStatusChange(null);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: StreamLine;
          try {
            parsed = JSON.parse(trimmed) as StreamLine;
          } catch {
            continue;
          }

          if ('error' in parsed) {
            streamError = parsed.error;
            done = true;
            scheduleStatusChange(null);
            return;
          }

          partial = parsed.partial as Record<string, unknown>;
          scheduleStatusChange(deriveStatusLabel(partial));

          if (parsed.done) {
            done = true;
            scheduleStatusChange(null);
          }
        }
      }
    } catch (err) {
      streamError = err instanceof Error ? err.message : 'Unknown error';
      scheduleStatusChange(null);
    } finally {
      loading = false;
      if (!done) {
        done = true;
        scheduleStatusChange(null);
      }
      if (statusTimer !== null) {
        clearTimeout(statusTimer);
        statusTimer = null;
      }
    }
  }

  $effect(() => {
    if (prompt) startStream();
    return () => {
      if (statusTimer !== null) {
        clearTimeout(statusTimer);
        statusTimer = null;
      }
    };
  });
</script>

{#if type === 'action_plan'}
  <ActionPlanStream {partial} {done} error={streamError} />
{:else if type === 'search_results'}
  <SearchResultStream {partial} {done} error={streamError} />
{:else}
  <div class="unsupported">
    Unsupported stream type: <code>{type}</code>
  </div>
{/if}

<style>
  .unsupported {
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--color-bg2);
    color: var(--color-muted);
    font-size: 12px;
  }
</style>
