<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Loader2, Plus, Sparkles, Square, Trash2, Users } from 'lucide-svelte';
  import {
    advanceGroupchat,
    cancelGroupchat,
    createGroupchat,
    getGroupchat,
    loadModels,
    suggestSubagents,
    type GroupchatCtx,
    type ModelItem,
  } from '$lib/state/workshop/experiments.svelte';

  type Step = 'prompt' | 'agents' | 'configure' | 'run';
  type PersonaDraft = { name: string; systemPrompt: string; modelId: string };

  const STYLES = ['debate', 'brainstorm', 'critique', 'red-team', 'freeform'] as const;

  let models = $state<ModelItem[]>([]);
  let step = $state<Step>('prompt');

  let prompt = $state('');
  let personas = $state<PersonaDraft[]>([]);
  let suggesting = $state(false);

  let rounds = $state(2);
  let infinite = $state(false);
  let style = $state<string>('debate');
  let includeOrchestrator = $state(true);
  let background = $state(true);

  let runId = $state<string | null>(null);
  let ctx = $state<GroupchatCtx | null>(null);
  let starting = $state(false);
  let polling = false;
  let stopped = false;

  const defaultModelId = $derived(models[0]?.id ?? '');

  onMount(async () => {
    try {
      const res = await loadModels();
      models = res.models;
    } catch {
      /* surfaced as empty model list */
    }
  });
  onDestroy(() => {
    stopped = true;
  });

  function modelById(id: string): ModelItem | undefined {
    return models.find((mo) => mo.id === id);
  }

  async function suggest() {
    if (suggesting || !prompt.trim() || !models[0]) return;
    suggesting = true;
    const out = await suggestSubagents(models[0], prompt);
    personas = out.map((p) => ({ ...p, modelId: defaultModelId }));
    suggesting = false;
    if (personas.length > 0) step = 'agents';
  }

  function addPersona() {
    personas = [...personas, { name: '', systemPrompt: '', modelId: defaultModelId }];
  }
  function removePersona(i: number) {
    personas = personas.filter((_, idx) => idx !== i);
  }

  const validPersonas = $derived(
    personas.filter((p) => p.name.trim() && p.systemPrompt.trim() && p.modelId),
  );

  async function start() {
    if (starting || validPersonas.length === 0) return;
    starting = true;
    stopped = false;
    try {
      runId = await createGroupchat({
        prompt,
        rounds: infinite ? null : Math.max(1, rounds),
        style,
        includeOrchestrator,
        background,
        agents: validPersonas.map((p) => {
          const m = modelById(p.modelId);
          return {
            name: p.name.trim(),
            systemPrompt: p.systemPrompt.trim(),
            provider: m?.provider ?? '',
            modelId: p.modelId,
          };
        }),
      });
      step = 'run';
      void pollLoop();
    } catch {
      starting = false;
    }
  }

  async function pollLoop() {
    if (!runId || polling) return;
    polling = true;
    while (!stopped && runId) {
      try {
        ctx = await getGroupchat(runId);
        const s = ctx.run.status;
        if (s === 'done' || s === 'cancelled' || s === 'failed') break;
        // Nudge the server forward while the page is open (durability still
        // comes from the cron tick when closed).
        await advanceGroupchat(runId);
      } catch {
        /* transient — keep polling */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    polling = false;
    starting = false;
  }

  async function stop() {
    if (!runId) return;
    stopped = true;
    await cancelGroupchat(runId);
    if (runId) ctx = await getGroupchat(runId).catch(() => ctx);
  }

  function agentName(agentId: string | null): string {
    if (!agentId) return 'Orchestrator';
    return ctx?.agents.find((a) => a.id === agentId)?.name ?? 'Agent';
  }

  function reset() {
    runId = null;
    ctx = null;
    stopped = true;
    step = 'prompt';
  }

  const running = $derived(ctx?.run.status === 'running' || ctx?.run.status === 'queued');
</script>

<div class="flex-1 overflow-y-auto p-6 max-w-3xl space-y-5">
  <header class="flex items-center justify-between">
    <h2 class="font-mono text-sm uppercase tracking-widest text-muted inline-flex items-center gap-2">
      <Users size={15} /> Model Group Chat
    </h2>
    {#if step === 'run'}
      <button type="button" onclick={reset} class="text-[10px] font-mono text-muted hover:text-foreground">new run</button>
    {/if}
  </header>

  {#if step === 'prompt'}
    <section class="space-y-3">
      <p class="text-[11px] font-mono uppercase tracking-wider text-muted-strong">1 · Problem</p>
      <textarea
        bind:value={prompt}
        rows="4"
        placeholder="The problem for the panel to solve…"
        class="w-full rounded border border-border bg-bg2 p-3 text-sm text-foreground font-mono resize-y outline-none focus:border-accent/50"
      ></textarea>
      <div class="flex gap-2">
        <button
          type="button"
          onclick={suggest}
          disabled={!prompt.trim() || suggesting || models.length === 0}
          class="h-8 px-4 rounded bg-accent/15 border border-accent/40 text-accent text-xs font-mono uppercase tracking-wider hover:bg-accent/25 disabled:opacity-40 inline-flex items-center gap-2"
        >
          {#if suggesting}<Loader2 size={13} class="animate-spin" />{:else}<Sparkles size={13} />{/if}
          Suggest subagents
        </button>
        <button
          type="button"
          onclick={() => { if (personas.length === 0) addPersona(); step = 'agents'; }}
          disabled={!prompt.trim()}
          class="h-8 px-4 rounded border border-border text-muted text-xs font-mono uppercase tracking-wider hover:text-foreground disabled:opacity-40"
        >
          Skip — add manually
        </button>
      </div>
    </section>
  {:else if step === 'agents'}
    <section class="space-y-3">
      <p class="text-[11px] font-mono uppercase tracking-wider text-muted-strong">2 · Subagents</p>
      {#each personas as p, i (i)}
        <div class="rounded border border-border bg-bg2 p-3 space-y-2">
          <div class="flex items-center gap-2">
            <input bind:value={p.name} placeholder="name" class="flex-1 h-7 rounded border border-border bg-bg3 px-2 text-xs font-mono outline-none" />
            <select bind:value={p.modelId} class="h-7 rounded border border-border bg-bg3 px-1.5 text-xs font-mono outline-none">
              {#each models as mo (mo.id)}<option value={mo.id}>{mo.name}</option>{/each}
            </select>
            <button type="button" onclick={() => removePersona(i)} class="text-muted hover:text-destructive"><Trash2 size={14} /></button>
          </div>
          <textarea bind:value={p.systemPrompt} rows="2" placeholder="role / system prompt" class="w-full rounded border border-border bg-bg3 p-2 text-xs font-mono resize-y outline-none"></textarea>
        </div>
      {/each}
      <button type="button" onclick={addPersona} class="h-7 px-3 rounded border border-border text-muted text-[11px] font-mono hover:text-foreground inline-flex items-center gap-1.5"><Plus size={12} /> Add subagent</button>
      <div class="flex gap-2 pt-1">
        <button type="button" onclick={() => (step = 'prompt')} class="h-8 px-4 rounded border border-border text-muted text-xs font-mono uppercase tracking-wider hover:text-foreground">Back</button>
        <button type="button" onclick={() => (step = 'configure')} disabled={validPersonas.length === 0} class="h-8 px-4 rounded bg-accent/15 border border-accent/40 text-accent text-xs font-mono uppercase tracking-wider hover:bg-accent/25 disabled:opacity-40">Configure ({validPersonas.length})</button>
      </div>
    </section>
  {:else if step === 'configure'}
    <section class="space-y-4">
      <p class="text-[11px] font-mono uppercase tracking-wider text-muted-strong">3 · Configure</p>
      <div class="space-y-3 text-xs font-mono">
        <div class="flex items-center gap-3">
          <span class="text-muted w-28">Rounds</span>
          <input type="number" min="1" bind:value={rounds} disabled={infinite} class="w-20 rounded border border-border bg-bg2 px-2 py-1 disabled:opacity-40" />
          <label class="flex items-center gap-1.5 text-muted cursor-pointer"><input type="checkbox" bind:checked={infinite} class="accent-accent" /> infinite (until stopped)</label>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-muted w-28">Style</span>
          <select bind:value={style} class="rounded border border-border bg-bg2 px-2 py-1">
            {#each STYLES as s (s)}<option value={s}>{s}</option>{/each}
          </select>
        </div>
        <label class="flex items-center gap-2 text-muted cursor-pointer"><input type="checkbox" bind:checked={includeOrchestrator} class="accent-accent" /> Include orchestrator (final summary &amp; decision)</label>
        <label class="flex items-center gap-2 text-muted cursor-pointer"><input type="checkbox" bind:checked={background} class="accent-accent" /> Run in background (survives navigation)</label>
      </div>
      <div class="flex gap-2">
        <button type="button" onclick={() => (step = 'agents')} class="h-8 px-4 rounded border border-border text-muted text-xs font-mono uppercase tracking-wider hover:text-foreground">Back</button>
        <button type="button" onclick={start} disabled={starting} class="h-8 px-4 rounded bg-accent/15 border border-accent/40 text-accent text-xs font-mono uppercase tracking-wider hover:bg-accent/25 disabled:opacity-40 inline-flex items-center gap-2">
          {#if starting}<Loader2 size={13} class="animate-spin" />{/if} Start
        </button>
      </div>
    </section>
  {:else if step === 'run'}
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted-strong">
          4 · {ctx?.run.status ?? 'starting'}{#if running} · round {ctx?.run.currentRound}{/if}
        </p>
        {#if running}
          <button type="button" onclick={stop} class="h-7 px-3 rounded border border-destructive/40 text-destructive text-[11px] font-mono inline-flex items-center gap-1.5 hover:bg-destructive/10"><Square size={11} /> Stop</button>
        {/if}
      </div>

      {#if !ctx}
        <p class="text-xs font-mono text-muted inline-flex items-center gap-1.5"><Loader2 size={13} class="animate-spin" /> starting…</p>
      {:else}
        <div class="space-y-2">
          {#each ctx.messages as msg (msg.id)}
            <div class={`rounded border p-3 ${msg.agentId ? 'border-border bg-bg2' : 'border-accent/40 bg-accent/5'}`}>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] font-mono {msg.agentId ? 'text-foreground' : 'text-accent'}">{agentName(msg.agentId)}</span>
                <span class="text-[9px] font-mono text-muted-strong">r{msg.round}{#if msg.modelId} · {msg.modelId}{/if}</span>
              </div>
              <p class="text-xs font-mono whitespace-pre-wrap text-foreground/90">{msg.content}</p>
            </div>
          {/each}
          {#if running}
            <p class="text-[11px] font-mono text-muted inline-flex items-center gap-1.5"><Loader2 size={12} class="animate-spin" /> thinking…</p>
          {/if}
          {#if ctx.messages.length === 0 && !running}
            <p class="text-xs font-mono text-muted italic">No turns yet.</p>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
</div>
