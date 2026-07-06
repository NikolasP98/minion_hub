<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { submitOnEnter } from '$lib/hotkeys';
  import { Sparkles, Send, Check, X } from 'lucide-svelte';
  import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { WorkingFlow } from '$lib/flows/flow-ops';

  let {
    flowId,
    onpreview,
    onapply,
    onreject,
  }: {
    flowId: string;
    onpreview: (proposed: WorkingFlow | null) => void;
    onapply: (proposed: WorkingFlow) => void;
    onreject: () => void;
  } = $props();

  type Turn = { role: 'user' | 'assistant'; content: string };
  let messages = $state<Turn[]>([]);
  let input = $state('');
  let busy = $state(false);
  let proposal = $state<WorkingFlow | null>(null);
  let validation = $state<{ ok: boolean; issues: string[] } | null>(null);
  let errorMsg = $state('');

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    messages = [...messages, { role: 'user', content: text }];
    input = '';
    busy = true;
    errorMsg = '';
    try {
      const res = await fetch(`/api/flows/${flowId}/copilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        errorMsg = (b as { message?: string }).message ?? `Error ${res.status}`;
        return;
      }
      const data = (await res.json()) as {
        message: string;
        proposedFlow: WorkingFlow;
        validation: { ok: boolean; issues: string[] };
      };
      messages = [...messages, { role: 'assistant', content: data.message }];
      proposal = data.proposedFlow;
      validation = data.validation;
      onpreview(data.proposedFlow);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      busy = false;
    }
  }

  function apply() {
    if (proposal) onapply(proposal);
    proposal = null;
    validation = null;
    onpreview(null);
  }
  function reject() {
    proposal = null;
    validation = null;
    onpreview(null);
    onreject();
  }
</script>

<aside class="flex h-full w-80 shrink-0 flex-col border-l border-white/10 bg-white/[0.02]">
  <header class="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">
    <Sparkles size={15} />
    {m.flow_copilot_title()}
  </header>

  <div class="flex-1 space-y-3 overflow-y-auto p-3">
    {#each messages as msg (msg)}
      <ChatMessage message={msg} />
    {/each}
    {#if busy}
      <div class="flex items-center gap-2 text-xs text-white/50">
        <Spinner size="xs" /> {m.flow_copilot_thinking()}
      </div>
    {/if}
    {#if errorMsg}<p class="text-xs text-red-400">{errorMsg}</p>{/if}
  </div>

  {#if proposal}
    <div class="border-t border-white/10 p-3">
      <p class="mb-2 text-xs text-white/70">{m.flow_copilot_proposed()}</p>
      {#if validation && !validation.ok}
        <p class="mb-2 text-[11px] text-amber-300">{m.flow_copilot_invalid()}</p>
      {/if}
      <div class="flex gap-2">
        <button
          type="button"
          onclick={apply}
          class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25"
        >
          <Check size={13} /> {m.flow_copilot_confirm()}
        </button>
        <button
          type="button"
          onclick={reject}
          class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 ring-1 ring-white/10 hover:bg-white/10"
        >
          <X size={13} /> {m.flow_copilot_reject()}
        </button>
      </div>
    </div>
  {/if}

  <div class="border-t border-white/10 p-3">
    <div class="flex items-end gap-2">
      <textarea
        bind:value={input}
        rows={2}
        placeholder={m.flow_copilot_placeholder()}
        {@attach submitOnEnter(() => send())}
        class="flex-1 resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30"
      ></textarea>
      <button
        type="button"
        onclick={send}
        disabled={busy || !input.trim()}
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
      >
        <Send size={15} />
      </button>
    </div>
  </div>
</aside>
