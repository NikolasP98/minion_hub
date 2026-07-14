<script lang="ts">
  import { onMount } from 'svelte';
  import { Eye, EyeOff, Loader2, Settings2, Trophy } from 'lucide-svelte';
  import LeaderboardStrip from './LeaderboardStrip.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    loadModels,
    runComparison,
    saveComparison,
    setEnabledModels,
    submitRanking,
    suggestCategories,
    type CompareOutput,
    type ModelItem,
  } from '$lib/state/workshop/experiments.svelte';
  import { Button } from '$lib/components/ui';

  let lbRefresh = $state(0);

  let models = $state<ModelItem[]>([]);
  let role = $state<'admin' | 'user'>('user');
  let modelsError = $state<string | null>(null);
  let selected = $state<Set<string>>(new Set());

  // Admin-only model curation panel.
  let manageOpen = $state(false);
  let manageEnabled = $state<Set<string>>(new Set());
  let savingModels = $state(false);
  let manageSaveError = $state<string | null>(null);
  let manageSaved = $state(false);

  let prompt = $state('');
  let system = $state('');
  let temperature = $state(0.7);
  let maxTokens = $state(1024);
  let blind = $state(false);

  let running = $state(false);
  let outputs = $state<CompareOutput[]>([]);
  let runId = $state<string | null>(null);
  let revealed = $state(false);

  // Ranking: best-first ordered model ids built by click order.
  let ranking = $state<string[]>([]);
  let categories = $state<string[]>([]);
  let categoryInput = $state('');
  let savingRank = $state(false);
  let rankSaved = $state(false);

  onMount(async () => {
    try {
      const res = await loadModels();
      models = res.models;
      role = res.role ?? 'user';
    } catch (e) {
      modelsError = e instanceof Error ? e.message : String(e);
    }
  });

  const selectedModels = $derived(models.filter((mo) => selected.has(mo.id)));
  const blindHidden = $derived(blind && !revealed);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function openManage() {
    manageEnabled = new Set(models.filter((mo) => mo.enabled !== false).map((mo) => mo.id));
    manageSaveError = null;
    manageSaved = false;
    manageOpen = true;
  }

  function toggleManage(id: string) {
    const next = new Set(manageEnabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    manageEnabled = next;
    manageSaved = false;
  }

  function manageEnableAll() {
    manageEnabled = new Set(models.map((mo) => mo.id));
    manageSaved = false;
  }

  function manageDisableAll() {
    manageEnabled = new Set();
    manageSaved = false;
  }

  async function saveManagedModels() {
    if (savingModels) return;
    savingModels = true;
    manageSaveError = null;
    try {
      await setEnabledModels([...manageEnabled]);
      const res = await loadModels();
      models = res.models;
      role = res.role ?? role;
      manageSaved = true;
    } catch (e) {
      manageSaveError = e instanceof Error ? e.message : String(e);
    }
    savingModels = false;
  }

  function labelFor(o: CompareOutput, i: number): string {
    if (blindHidden) return m.workshop_exp_model_label({ letter: String.fromCharCode(65 + i) });
    return o.name;
  }

  async function run() {
    if (running || selectedModels.length === 0 || !prompt.trim()) return;
    running = true;
    runId = null;
    revealed = false;
    rankSaved = false;
    ranking = [];
    outputs = selectedModels.map((mo) => ({
      modelId: mo.id,
      provider: mo.provider,
      name: mo.name,
      status: 'pending' as const,
      text: '',
    }));

    await runComparison(
      selectedModels,
      prompt,
      system.trim() || undefined,
      { temperature, maxTokens },
      outputs,
    );

    try {
      runId = await saveComparison({
        prompt,
        system: system.trim() || undefined,
        params: { temperature, maxTokens },
        blind,
        outputs,
      });
    } catch {
      // Persistence failure shouldn't lose the visible results.
    }
    running = false;

    // Fire-and-forget category suggestions from the first model.
    if (categories.length === 0 && selectedModels[0]) {
      suggestCategories(selectedModels[0], prompt).then((tags) => {
        if (categories.length === 0) categories = tags;
      });
    }
  }

  function rankClick(modelId: string) {
    if (ranking.includes(modelId)) return;
    ranking = [...ranking, modelId];
  }
  function resetRank() {
    ranking = [];
  }
  function rankPos(modelId: string): number {
    return ranking.indexOf(modelId) + 1;
  }

  function addCategory() {
    const v = categoryInput.trim().toLowerCase();
    if (v && !categories.includes(v)) categories = [...categories, v];
    categoryInput = '';
  }
  function removeCategory(c: string) {
    categories = categories.filter((x) => x !== c);
  }

  const canSubmitRank = $derived(
    runId !== null && ranking.length === outputs.length && outputs.length > 0,
  );

  async function submitRank() {
    if (!runId || !canSubmitRank || savingRank) return;
    savingRank = true;
    try {
      await submitRanking(runId, ranking, categories);
      revealed = true;
      rankSaved = true;
      lbRefresh += 1;
    } catch {
      /* surfaced via rankSaved staying false */
    }
    savingRank = false;
  }
</script>

<div class="flex-1 overflow-y-auto p-6 space-y-5">
  <header class="flex items-center justify-between">
    <h2 class="font-mono text-sm uppercase tracking-widest text-muted">
      {m.workshop_exp_compare_title()}
    </h2>
    <label class="flex items-center gap-2 text-xs font-mono text-muted cursor-pointer select-none">
      <input type="checkbox" bind:checked={blind} class="accent-accent" />
      {#if blind}<EyeOff size={13} />{:else}<Eye size={13} />{/if}
      {m.workshop_exp_blind_mode()}
    </label>
  </header>

  <LeaderboardStrip refresh={lbRefresh} />

  {#if modelsError}
    <p class="text-xs font-mono text-destructive">
      {m.workshop_exp_models_load_error({ error: modelsError })}
    </p>
  {/if}

  <!-- Model picker -->
  <section class="space-y-2">
    <div class="flex items-center justify-between">
      <p class="text-xs font-mono uppercase tracking-wider text-muted-strong">
        {m.workshop_exp_models_label()}
        {#if role === 'admin'}<span class="text-accent/70">{m.workshop_exp_models_admin()}</span
          >{/if}
      </p>
      {#if role === 'admin'}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onclick={() => (manageOpen ? (manageOpen = false) : openManage())}
          class="text-xs font-mono text-muted hover:text-foreground inline-flex items-center gap-1"
        >
          <Settings2 size={11} />
          {m.workshop_exp_manage_models()}
        </Button>
      {/if}
    </div>

    {#if role === 'admin' && manageOpen}
      <div class="rounded border border-border bg-bg2 p-3 space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-xs font-mono uppercase tracking-wider text-muted-strong">
            {m.workshop_exp_manage_models_title()}
          </p>
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={manageEnableAll}
              class="font-mono text-muted">{m.workshop_exp_manage_enable_all()}</Button
            >
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={manageDisableAll}
              class="font-mono text-muted">{m.workshop_exp_manage_disable_all()}</Button
            >
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each models as mo (mo.id)}
            <label
              class="px-2 h-7 rounded border border-border text-xs font-mono text-foreground inline-flex items-center gap-1.5 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={manageEnabled.has(mo.id)}
                onchange={() => toggleManage(mo.id)}
                class="accent-accent"
              />
              {mo.name}
            </label>
          {/each}
        </div>
        {#if manageEnabled.size === 0}
          <p class="text-xs font-mono text-destructive">{m.workshop_exp_manage_empty_warning()}</p>
        {/if}
        {#if manageSaveError}
          <p class="text-xs font-mono text-destructive">
            {m.workshop_exp_manage_save_error({ error: manageSaveError })}
          </p>
        {/if}
        <div class="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onclick={saveManagedModels}
            disabled={savingModels}
            class="h-7 px-3 rounded bg-accent/15 border border-accent/40 text-accent text-xs font-mono uppercase tracking-wider hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
          >
            {#if savingModels}<Loader2 size={11} class="animate-spin" />{/if}
            {manageSaved ? m.workshop_exp_manage_saved() : m.workshop_exp_manage_save()}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onclick={() => (manageOpen = false)}
            class="font-mono text-muted">{m.workshop_exp_manage_close()}</Button
          >
        </div>
      </div>
    {/if}

    <div class="flex flex-wrap gap-1.5">
      {#each models as mo (mo.id)}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onclick={() => toggle(mo.id)}
          class={`px-2.5 h-7 rounded border text-xs font-mono transition-colors ${
            selected.has(mo.id)
              ? 'border-accent bg-accent/10 text-foreground'
              : 'border-border text-muted hover:text-foreground hover:border-accent/30'
          }`}
          title={`${mo.provider} · ${mo.id}`}
        >
          {mo.name}
          {#if role === 'admin' && mo.enabled === false}
            <span class="ml-1 text-muted-strong">·{m.workshop_exp_off()}</span>
          {/if}
        </Button>
      {/each}
      {#if models.length === 0 && !modelsError}
        <p class="text-xs font-mono text-muted italic">{m.workshop_exp_no_models()}</p>
      {/if}
    </div>
  </section>

  <!-- Prompt + params -->
  <section class="space-y-2">
    <textarea
      bind:value={prompt}
      placeholder={m.workshop_exp_prompt_placeholder()}
      rows="4"
      class="w-full rounded border border-border bg-bg2 p-3 text-sm text-foreground font-mono resize-y focus:border-accent/50 outline-none"
    ></textarea>
    <details class="text-xs font-mono text-muted">
      <summary class="cursor-pointer select-none">{m.workshop_exp_advanced()}</summary>
      <div class="mt-2 space-y-2">
        <textarea
          bind:value={system}
          placeholder={m.workshop_exp_system_placeholder()}
          rows="2"
          class="w-full rounded border border-border bg-bg2 p-2 text-xs text-foreground font-mono resize-y outline-none"
        ></textarea>
        <div class="flex gap-4">
          <label class="flex items-center gap-2"
            >{m.workshop_exp_temp()}
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              bind:value={temperature}
              class="w-16 rounded border border-border bg-bg2 px-1.5 py-0.5"
            />
          </label>
          <label class="flex items-center gap-2"
            >{m.workshop_exp_max_tokens()}
            <input
              type="number"
              min="1"
              step="1"
              bind:value={maxTokens}
              class="w-20 rounded border border-border bg-bg2 px-1.5 py-0.5"
            />
          </label>
        </div>
      </div>
    </details>
    <Button
      type="button"
      variant="outline"
      size="sm"
      onclick={run}
      disabled={running || selectedModels.length === 0 || !prompt.trim()}
      class="h-8 px-4 rounded bg-accent/15 border border-accent/40 text-accent text-xs font-mono uppercase tracking-wider hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
    >
      {#if running}<Loader2 size={13} class="animate-spin" />{/if}
      {m.workshop_exp_run({ count: selectedModels.length })}
    </Button>
  </section>

  <!-- Results -->
  {#if outputs.length > 0}
    <section
      class="grid gap-3"
      style={`grid-template-columns: repeat(${Math.min(outputs.length, 3)}, minmax(0, 1fr));`}
    >
      {#each outputs as o, i (o.modelId)}
        <div class="rounded border border-border bg-bg2 flex flex-col min-h-[160px]">
          <div class="flex items-center justify-between px-3 h-9 border-b border-border">
            <span class="text-xs font-mono text-foreground truncate">{labelFor(o, i)}</span>
            <span class="text-xs font-mono text-muted-strong shrink-0">
              {#if o.status === 'pending'}…{:else if o.latencyMs}{o.latencyMs}ms{/if}
            </span>
          </div>
          <div
            class="p-3 text-xs font-mono whitespace-pre-wrap text-foreground/90 flex-1 overflow-y-auto max-h-[420px]"
          >
            {#if o.status === 'pending'}
              <span class="text-muted inline-flex items-center gap-1"
                ><Loader2 size={12} class="animate-spin" /> {m.workshop_exp_thinking()}</span
              >
            {:else if o.status === 'error'}
              <span class="text-destructive">{o.error}</span>
            {:else}
              {o.text}
            {/if}
          </div>
          {#if o.status === 'done' && !blindHidden}
            <div
              class="px-3 py-1.5 border-t border-border text-xs font-mono text-muted-strong flex gap-3"
            >
              {#if o.outputTokens}<span>{m.workshop_exp_tok({ count: o.outputTokens })}</span>{/if}
              {#if o.costUsd}<span>${o.costUsd.toFixed(4)}</span>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </section>

    <!-- Ranking -->
    {#if !running}
      <section class="rounded border border-border bg-bg2 p-4 space-y-3">
        <div class="flex items-center justify-between">
          <p
            class="text-xs font-mono uppercase tracking-wider text-muted inline-flex items-center gap-1.5"
          >
            <Trophy size={13} />
            {m.workshop_exp_rank_hint()}
          </p>
          {#if ranking.length > 0}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={resetRank}
              class="font-mono text-muted">{m.workshop_exp_reset()}</Button
            >
          {/if}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each outputs as o, i (o.modelId)}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={() => rankClick(o.modelId)}
              disabled={ranking.includes(o.modelId)}
              class={`px-2.5 h-7 rounded border text-xs font-mono transition-colors inline-flex items-center gap-1.5 ${
                ranking.includes(o.modelId)
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border text-muted hover:text-foreground hover:border-accent/30'
              }`}
            >
              {#if rankPos(o.modelId) > 0}<span class="text-accent font-bold"
                  >#{rankPos(o.modelId)}</span
                >{/if}
              {labelFor(o, i)}
            </Button>
          {/each}
        </div>

        <!-- Categories -->
        <div class="space-y-1.5">
          <p class="text-xs font-mono uppercase tracking-wider text-muted-strong">
            {m.workshop_exp_category_tags()}
          </p>
          <div class="flex flex-wrap items-center gap-1.5">
            {#each categories as c (c)}
              <span
                class="px-2 h-6 rounded-full border border-border text-xs font-mono text-muted inline-flex items-center gap-1"
              >
                {c}
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-5 w-5 hover:text-destructive"
                  type="button"
                  aria-label={m.common_remove()}
                  onclick={() => removeCategory(c)}>×</Button
                >
              </span>
            {/each}
            <input
              bind:value={categoryInput}
              onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addCategory())}
              placeholder={m.workshop_exp_add_tag()}
              class="h-6 w-24 rounded border border-border bg-bg3 px-2 text-xs font-mono outline-none"
            />
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={submitRank}
          disabled={!canSubmitRank || savingRank}
          class="h-8 px-4 rounded bg-accent/15 border border-accent/40 text-accent text-xs font-mono uppercase tracking-wider hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {rankSaved
            ? m.workshop_exp_saved()
            : blind
              ? m.workshop_exp_save_ranking_reveal()
              : m.workshop_exp_save_ranking()}
        </Button>
        {#if !runId}
          <p class="text-xs font-mono text-muted-strong">{m.workshop_exp_run_not_persisted()}</p>
        {/if}
      </section>
    {/if}
  {/if}
</div>
