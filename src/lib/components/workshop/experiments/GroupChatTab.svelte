<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Loader2, Plus, Sparkles, Square, Trash2, Users } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
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
  import { Button, Select } from '$lib/components/ui';

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
          const mdl = modelById(p.modelId);
          return {
            name: p.name.trim(),
            systemPrompt: p.systemPrompt.trim(),
            provider: mdl?.provider ?? '',
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
    if (!agentId) return m.workshop_exp_orchestrator();
    return ctx?.agents.find((a) => a.id === agentId)?.name ?? m.workshop_exp_agent();
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
    <h2
      class="font-mono text-sm uppercase tracking-widest text-muted inline-flex items-center gap-2"
    >
      <Users size={15} />
      {m.workshop_exp_groupchat_title()}
    </h2>
    {#if step === 'run'}
      <Button variant="ghost" size="sm" type="button" onclick={reset} class="font-mono text-muted"
        >{m.workshop_exp_new_run()}</Button
      >
    {/if}
  </header>

  {#if step === 'prompt'}
    <section class="space-y-3">
      <p class="text-xs font-mono uppercase tracking-wider text-muted-strong">
        1 · {m.workshop_exp_step_problem()}
      </p>
      <textarea
        bind:value={prompt}
        rows="4"
        placeholder={m.workshop_exp_problem_placeholder()}
        class="w-full rounded border border-border bg-bg2 p-3 text-sm text-foreground font-mono resize-y outline-none focus:border-accent/50"
      ></textarea>
      <div class="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={suggest}
          disabled={!prompt.trim() || suggesting || models.length === 0}
          class="h-8 px-4 rounded bg-accent/15 border border-accent/40 text-accent text-xs font-mono uppercase tracking-wider hover:bg-accent/25 disabled:opacity-40 inline-flex items-center gap-2"
        >
          {#if suggesting}<Loader2 size={13} class="animate-spin" />{:else}<Sparkles
              size={13}
            />{/if}
          {m.workshop_exp_suggest_subagents()}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onclick={() => {
            if (personas.length === 0) addPersona();
            step = 'agents';
          }}
          disabled={!prompt.trim()}
          class="h-8 px-4 rounded border border-border text-muted text-xs font-mono uppercase tracking-wider hover:text-foreground disabled:opacity-40"
        >
          {m.workshop_exp_skip_manual()}
        </Button>
      </div>
    </section>
  {:else if step === 'agents'}
    <section class="space-y-3">
      <p class="text-xs font-mono uppercase tracking-wider text-muted-strong">
        2 · {m.workshop_exp_step_subagents()}
      </p>
      {#each personas as p, i (i)}
        <div class="rounded border border-border bg-bg2 p-3 space-y-2">
          <div class="flex items-center gap-2">
            <input
              bind:value={p.name}
              placeholder={m.workshop_exp_name()}
              class="flex-1 h-7 rounded border border-border bg-bg3 px-2 text-xs font-mono outline-none"
            />
            <Select bind:value={p.modelId} size="sm" class="font-mono">
              {#each models as mo (mo.id)}<option value={mo.id}>{mo.name}</option>{/each}
            </Select>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={m.common_remove()}
              onclick={() => removePersona(i)}
              class="text-muted hover:text-destructive"><Trash2 size={14} /></Button
            >
          </div>
          <textarea
            bind:value={p.systemPrompt}
            rows="2"
            placeholder={m.workshop_exp_role_system_prompt()}
            class="w-full rounded border border-border bg-bg3 p-2 text-xs font-mono resize-y outline-none"
          ></textarea>
        </div>
      {/each}
      <Button
        variant="secondary"
        size="sm"
        type="button"
        onclick={addPersona}
        class="font-mono text-muted"><Plus size={12} /> {m.workshop_exp_add_subagent()}</Button
      >
      <div class="flex gap-2 pt-1">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onclick={() => (step = 'prompt')}
          class="font-mono uppercase tracking-wider">{m.workshop_exp_back()}</Button
        >
        <Button
          variant="outline"
          size="sm"
          type="button"
          onclick={() => (step = 'configure')}
          disabled={validPersonas.length === 0}
          class="font-mono uppercase tracking-wider"
          >{m.workshop_exp_configure_count({ count: validPersonas.length })}</Button
        >
      </div>
    </section>
  {:else if step === 'configure'}
    <section class="space-y-4">
      <p class="text-xs font-mono uppercase tracking-wider text-muted-strong">
        3 · {m.workshop_exp_step_configure()}
      </p>
      <div class="space-y-3 text-xs font-mono">
        <div class="flex items-center gap-3">
          <span class="text-muted w-28">{m.workshop_exp_rounds()}</span>
          <input
            type="number"
            min="1"
            bind:value={rounds}
            disabled={infinite}
            class="w-20 rounded border border-border bg-bg2 px-2 py-1 disabled:opacity-40"
          />
          <label class="flex items-center gap-1.5 text-muted cursor-pointer"
            ><input type="checkbox" bind:checked={infinite} class="accent-accent" />
            {m.workshop_exp_infinite()}</label
          >
        </div>
        <div class="flex items-center gap-3">
          <span class="text-muted w-28">{m.workshop_exp_style()}</span>
          <Select bind:value={style} size="sm">
            {#each STYLES as s (s)}<option value={s}>{s}</option>{/each}
          </Select>
        </div>
        <label class="flex items-center gap-2 text-muted cursor-pointer"
          ><input type="checkbox" bind:checked={includeOrchestrator} class="accent-accent" />
          {m.workshop_exp_include_orchestrator()}</label
        >
        <label class="flex items-center gap-2 text-muted cursor-pointer"
          ><input type="checkbox" bind:checked={background} class="accent-accent" />
          {m.workshop_exp_run_background()}</label
        >
      </div>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onclick={() => (step = 'agents')}
          class="font-mono uppercase tracking-wider">{m.workshop_exp_back()}</Button
        >
        <Button
          variant="outline"
          size="sm"
          type="button"
          onclick={start}
          disabled={starting}
          class="font-mono uppercase tracking-wider"
        >
          {#if starting}<Loader2 size={13} class="animate-spin" />{/if}
          {m.workshop_exp_start()}
        </Button>
      </div>
    </section>
  {:else if step === 'run'}
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs font-mono uppercase tracking-wider text-muted-strong">
          4 · {ctx?.run.status ?? m.workshop_exp_status_starting()}{#if running}
            · {m.workshop_exp_round({ n: ctx?.run.currentRound ?? 0 })}{/if}
        </p>
        {#if running}
          <Button variant="danger" size="sm" type="button" onclick={stop} class="font-mono"
            ><Square size={11} /> {m.workshop_exp_stop()}</Button
          >
        {/if}
      </div>

      {#if !ctx}
        <p class="text-xs font-mono text-muted inline-flex items-center gap-1.5">
          <Loader2 size={13} class="animate-spin" />
          {m.workshop_exp_starting()}
        </p>
      {:else}
        <div class="space-y-2">
          {#each ctx.messages as msg (msg.id)}
            <div
              class={`rounded border p-3 ${msg.agentId ? 'border-border bg-bg2' : 'border-accent/40 bg-accent/5'}`}
            >
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-mono {msg.agentId ? 'text-foreground' : 'text-accent'}"
                  >{agentName(msg.agentId)}</span
                >
                <span class="text-xs font-mono text-muted-strong"
                  >r{msg.round}{#if msg.modelId}
                    · {msg.modelId}{/if}</span
                >
              </div>
              <p class="text-xs font-mono whitespace-pre-wrap text-foreground/90">{msg.content}</p>
            </div>
          {/each}
          {#if running}
            <p class="text-xs font-mono text-muted inline-flex items-center gap-1.5">
              <Loader2 size={12} class="animate-spin" />
              {m.workshop_exp_thinking()}
            </p>
          {/if}
          {#if ctx.messages.length === 0 && !running}
            <p class="text-xs font-mono text-muted italic">{m.workshop_exp_no_turns()}</p>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
</div>
