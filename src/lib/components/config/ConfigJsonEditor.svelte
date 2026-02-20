<script lang="ts">
  import { setField } from '$lib/state/config.svelte';

  let { path, value, pathSuffix = '' }: {
    path: string;
    value: unknown;
    pathSuffix?: string;
  } = $props();

  // Track whether user is actively editing (local override)
  let localText = $state<string | null>(null);
  let parseError = $state<string | null>(null);

  // Track prev value to detect external changes and reset local override
  let prevValueJson = $state<string>('');
  $effect(() => {
    const json = toJson(value);
    if (json !== prevValueJson) {
      prevValueJson = json;
      localText = null;
      parseError = null;
    }
  });

  const displayText = $derived(localText ?? toJson(value));

  function toJson(v: unknown): string {
    if (v === undefined || v === null) return '';
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  function onInput(e: Event) {
    const raw = (e.target as HTMLTextAreaElement).value;
    localText = raw;
    if (!raw.trim()) {
      parseError = null;
      setField(path, undefined);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      parseError = null;
      setField(path, parsed);
    } catch (err) {
      parseError = (err as Error).message;
    }
  }
</script>

<div class="flex flex-col gap-1">
  <textarea
    class="bg-bg3 border rounded-[5px] text-foreground py-[5px] px-[9px] font-mono text-xs outline-none transition-colors resize-y min-h-[60px]
      {parseError ? 'border-destructive focus:border-destructive' : 'border-border focus:border-accent'}"
    rows="4"
    value={displayText}
    oninput={onInput}
    spellcheck="false"
  ></textarea>
  {#if parseError}
    <p class="text-destructive text-[10px]">{parseError}</p>
  {/if}
</div>
