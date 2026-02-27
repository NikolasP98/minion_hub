<script lang="ts">
  import { diceBearAvatarUrl } from '$lib/utils/avatar';
  import * as m from '$lib/paraglide/messages';

  interface GeneratedAgent {
    soulMd: string;
    identityMd: string;
    userMd: string;
    contextMd: string;
    skillsMd: string;
    agentJson: {
      id: string;
      name: string;
      role: string;
      category: string;
      tags: string[];
      description: string;
      catchphrase: string;
      version: string;
      model: string;
      avatarSeed: string;
    };
  }

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  type Step = 1 | 2 | 3 | 4 | 5;

  let step = $state<Step>(1);
  let generating = $state(false);
  let generateError = $state<string | null>(null);
  let generated = $state<GeneratedAgent | null>(null);
  let activeDocPreview = $state<'soul' | 'identity' | 'user' | 'context' | 'skills'>('soul');

  // Step 1 fields
  let role = $state('');
  let category = $state('engineering');

  // Step 2 fields
  let agentName = $state('');
  let catchphrase = $state('');
  let formalCasual = $state(50);
  let cautiousBold = $state(50);
  let technicalStrategic = $state(50);

  const categories = ['engineering', 'product', 'data', 'creative', 'security'];

  const categoryLabels: Record<string, () => string> = {
    engineering: () => m.marketplace_agentsListCategoryEngineering(),
    product: () => m.marketplace_agentsListCategoryProduct(),
    data: () => m.marketplace_agentsListCategoryData(),
    creative: () => m.marketplace_agentsListCategoryCreative(),
    security: () => m.marketplace_agentsListCategorySecurity(),
  };

  const avatarUrl = $derived(
    generated ? diceBearAvatarUrl(generated.agentJson.avatarSeed) : ''
  );

  async function generate() {
    if (!agentName || !role) return;
    generating = true;
    generateError = null;
    try {
      const res = await fetch('/api/marketplace/generate-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          role,
          category,
          personality: { catchphrase, formalCasual, cautiousBold, technicalStrategic },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        generateError = text || 'Generation failed';
        return;
      }
      generated = await res.json();
      step = 4;
    } catch (err) {
      generateError = (err as Error).message;
    } finally {
      generating = false;
    }
  }

  function buildZipContent(): string {
    if (!generated) return '';
    const files: Record<string, string> = {
      'agent.json': JSON.stringify(generated.agentJson, null, 2),
      'SOUL.md': generated.soulMd,
      'IDENTITY.md': generated.identityMd,
      'USER.md': generated.userMd,
      'CONTEXT.md': generated.contextMd,
      'SKILLS.md': generated.skillsMd,
    };
    return Object.entries(files)
      .map(([name, content]) => `=== ${name} ===\n\n${content}`)
      .join('\n\n---\n\n');
  }

  function downloadFiles() {
    if (!generated) return;
    const content = buildZipContent();
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${generated.agentJson.id}-agent-files.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const docTabs = [
    { id: 'soul' as const, label: 'SOUL', key: 'soulMd' as const },
    { id: 'identity' as const, label: 'IDENTITY', key: 'identityMd' as const },
    { id: 'user' as const, label: 'USER', key: 'userMd' as const },
    { id: 'context' as const, label: 'CONTEXT', key: 'contextMd' as const },
    { id: 'skills' as const, label: 'SKILLS', key: 'skillsMd' as const },
  ];

  function sliderLabel(val: number, low: string, high: string): string {
    if (val < 30) return low;
    if (val > 70) return high;
    return m.marketplace_wizardStep2Balanced();
  }
</script>

<!-- Modal backdrop -->
<div
  class="fixed inset-0 z-200 bg-black/70 flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Create Marketplace Agent"
>
  <div class="bg-bg2 border border-border rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
      <div>
        <h2 class="text-sm font-bold text-foreground">{m.marketplace_wizardTitle()}</h2>
        <p class="text-[10px] text-muted mt-0.5">{m.marketplace_wizardStepOf({ step: step, total: 5 })}</p>
      </div>
      <!-- Progress dots -->
      <div class="flex items-center gap-1.5 mx-auto">
        {#each [1, 2, 3, 4, 5] as s (s)}
          <div class="w-1.5 h-1.5 rounded-full transition-colors {step >= s ? 'bg-brand-pink' : 'bg-border'}"></div>
        {/each}
      </div>
      <button
        type="button"
        onclick={onClose}
        class="text-muted hover:text-foreground transition-colors text-lg leading-none"
        aria-label={m.common_close()}
      >
        ×
      </button>
    </div>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto px-5 py-5">

      <!-- Step 1: Role & Category -->
      {#if step === 1}
        <div class="flex flex-col gap-4">
          <div>
            <h3 class="text-sm font-semibold text-foreground mb-1">{m.marketplace_wizardStep1Heading()}</h3>
            <p class="text-xs text-muted">{m.marketplace_wizardStep1Subtitle()}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs text-muted" for="role-input">{m.marketplace_wizardStep1RoleLabel()}</label>
            <input
              id="role-input"
              type="text"
              placeholder={m.marketplace_wizardStep1RolePlaceholder()}
              bind:value={role}
              class="w-full px-3 py-2 rounded-lg border border-border bg-bg3 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-brand-pink/40 transition-colors"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs text-muted" for="category-select">{m.marketplace_wizardStep1CategoryLabel()}</label>
            <select
              id="category-select"
              bind:value={category}
              class="w-full px-3 py-2 rounded-lg border border-border bg-bg3 text-sm text-foreground focus:outline-none focus:border-brand-pink/40 transition-colors capitalize"
            >
              {#each categories as cat (cat)}
                <option value={cat}>{categoryLabels[cat]?.() ?? cat}</option>
              {/each}
            </select>
          </div>
        </div>

      <!-- Step 2: Personality -->
      {:else if step === 2}
        <div class="flex flex-col gap-4">
          <div>
            <h3 class="text-sm font-semibold text-foreground mb-1">{m.marketplace_wizardStep2Heading()}</h3>
            <p class="text-xs text-muted">{m.marketplace_wizardStep2Subtitle()}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs text-muted" for="name-input">{m.marketplace_wizardStep2NameLabel()}</label>
            <input
              id="name-input"
              type="text"
              placeholder={m.marketplace_wizardStep2NamePlaceholder()}
              bind:value={agentName}
              class="w-full px-3 py-2 rounded-lg border border-border bg-bg3 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-brand-pink/40 transition-colors"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs text-muted" for="catchphrase-input">{m.marketplace_wizardStep2CatchphraseLabel()}</label>
            <input
              id="catchphrase-input"
              type="text"
              placeholder={m.marketplace_wizardStep2CatchphrasePlaceholder()}
              bind:value={catchphrase}
              class="w-full px-3 py-2 rounded-lg border border-border bg-bg3 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-brand-pink/40 transition-colors"
            />
          </div>

          <!-- Sliders -->
          {#each [
            { label: m.marketplace_wizardStep2ToneLabel(), low: m.marketplace_wizardStep2ToneFormal(), high: m.marketplace_wizardStep2ToneCasual(), bind: 'formalCasual' },
            { label: m.marketplace_wizardStep2RiskLabel(), low: m.marketplace_wizardStep2RiskCautious(), high: m.marketplace_wizardStep2RiskBold(), bind: 'cautiousBold' },
            { label: m.marketplace_wizardStep2ThinkingLabel(), low: m.marketplace_wizardStep2ThinkingTechnical(), high: m.marketplace_wizardStep2ThinkingStrategic(), bind: 'technicalStrategic' },
          ] as slider (slider.bind)}
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted">{slider.label}</span>
                <span class="text-[10px] text-brand-pink">
                  {#if slider.bind === 'formalCasual'}
                    {sliderLabel(formalCasual, slider.low, slider.high)}
                  {:else if slider.bind === 'cautiousBold'}
                    {sliderLabel(cautiousBold, slider.low, slider.high)}
                  {:else}
                    {sliderLabel(technicalStrategic, slider.low, slider.high)}
                  {/if}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-muted w-14 text-right">{slider.low}</span>
                {#if slider.bind === 'formalCasual'}
                  <input type="range" min="0" max="100" bind:value={formalCasual} class="flex-1 accent-brand-pink" />
                {:else if slider.bind === 'cautiousBold'}
                  <input type="range" min="0" max="100" bind:value={cautiousBold} class="flex-1 accent-brand-pink" />
                {:else}
                  <input type="range" min="0" max="100" bind:value={technicalStrategic} class="flex-1 accent-brand-pink" />
                {/if}
                <span class="text-[10px] text-muted w-14">{slider.high}</span>
              </div>
            </div>
          {/each}
        </div>

      <!-- Step 3: Generate -->
      {:else if step === 3}
        <div class="flex flex-col items-center gap-5 py-4 text-center">
          <div class="w-16 h-16 rounded-full bg-brand-pink/10 border border-brand-pink/20 flex items-center justify-center text-2xl">
            ✨
          </div>
          <div>
            <h3 class="text-sm font-semibold text-foreground">{m.marketplace_wizardStep3Heading()}</h3>
            <p class="text-xs text-muted mt-1">
              {m.marketplace_wizardStep3Body({ name: agentName })}
            </p>
          </div>
          <div class="w-full bg-bg3 border border-border rounded-lg p-3 text-left text-xs text-muted space-y-1">
            <div><span class="text-foreground font-medium">{m.marketplace_wizardStep3NameLabel()}</span> {agentName}</div>
            <div><span class="text-foreground font-medium">{m.marketplace_wizardStep3RoleLabel()}</span> {role}</div>
            <div><span class="text-foreground font-medium">{m.marketplace_wizardStep3CategoryLabel()}</span> {category}</div>
            {#if catchphrase}<div><span class="text-foreground font-medium">{m.marketplace_wizardStep3CatchphraseLabel()}</span> "{catchphrase}"</div>{/if}
          </div>
          {#if generateError}
            <div class="w-full rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400 text-left">
              {generateError}
            </div>
          {/if}
          <button
            type="button"
            onclick={generate}
            disabled={generating}
            class="w-full py-2.5 rounded-lg bg-brand-pink text-black text-sm font-semibold hover:bg-brand-pink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {#if generating}
              <span class="animate-spin">↻</span>
              {m.marketplace_wizardStep3Generating()}
            {:else}
              {m.marketplace_wizardStep3Generate()}
            {/if}
          </button>
        </div>

      <!-- Step 4: Preview -->
      {:else if step === 4 && generated}
        <div class="flex flex-col gap-4">
          <!-- Avatar + name -->
          <div class="flex items-center gap-3">
            <div class="w-14 h-14 rounded-full bg-bg3 border border-border overflow-hidden shrink-0">
              <img src={avatarUrl} alt={generated.agentJson.name} class="w-full h-full object-cover" />
            </div>
            <div>
              <p class="text-sm font-bold text-foreground">{generated.agentJson.name}</p>
              <p class="text-xs text-muted">{generated.agentJson.role}</p>
              {#if generated.agentJson.catchphrase}
                <p class="text-xs italic text-brand-pink mt-0.5">"{generated.agentJson.catchphrase}"</p>
              {/if}
            </div>
          </div>

          <!-- Doc tabs -->
          <div class="flex gap-1 bg-bg3 border border-border rounded-lg p-1">
            {#each docTabs as dt (dt.id)}
              <button
                type="button"
                onclick={() => { activeDocPreview = dt.id; }}
                class="flex-1 py-1 text-[10px] font-mono font-medium rounded transition-colors {activeDocPreview === dt.id ? 'bg-brand-pink/10 text-brand-pink' : 'text-muted hover:text-foreground'}"
              >
                {dt.label}
              </button>
            {/each}
          </div>

          <!-- Doc preview -->
          <div class="bg-bg3 border border-border rounded-lg p-3 max-h-40 overflow-y-auto">
            {#each docTabs as dt (dt.id)}
              {#if activeDocPreview === dt.id}
                <pre class="text-[10px] text-foreground/70 whitespace-pre-wrap font-mono leading-relaxed">{generated[dt.key]}</pre>
              {/if}
            {/each}
          </div>

          <p class="text-xs text-muted text-center">
            {m.marketplace_wizardStep4Hint()}
          </p>
        </div>

      <!-- Step 5: Export -->
      {:else if step === 5 && generated}
        <div class="flex flex-col gap-4">
          <div>
            <h3 class="text-sm font-semibold text-foreground mb-1">{m.marketplace_wizardStep5Heading()}</h3>
            <p class="text-xs text-muted">{m.marketplace_wizardStep5Subtitle()}</p>
          </div>

          <button
            type="button"
            onclick={downloadFiles}
            class="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-pink/10 border border-brand-pink/30 text-brand-pink text-sm font-medium hover:bg-brand-pink/20 transition-colors"
          >
            {m.marketplace_wizardStep5DownloadBtn()}
          </button>

          <div class="bg-bg3 border border-border rounded-lg p-3 text-xs text-muted font-mono leading-relaxed">
            <p class="text-foreground font-semibold mb-2"># Push to GitHub</p>
            <p>cd ~/nikolasp98/minions</p>
            <p>mkdir -p agents/{generated.agentJson.id}</p>
            <p># Extract downloaded files into agents/{generated.agentJson.id}/</p>
            <p>git add agents/{generated.agentJson.id}/</p>
            <p>git commit -m "feat: add {generated.agentJson.name}"</p>
            <p>git push</p>
          </div>

          <div class="bg-bg3 border border-border rounded-lg p-3 text-xs text-muted leading-relaxed">
            <p class="text-foreground font-semibold mb-1">{m.marketplace_wizardStep5SyncHeading()}</p>
            <p>{m.marketplace_wizardStep5SyncHint()}</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer nav -->
    <div class="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
      <button
        type="button"
        onclick={() => { if (step > 1) step = (step - 1) as Step; }}
        disabled={step === 1}
        class="text-xs text-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        {m.marketplace_wizardBack()}
      </button>

      {#if step < 3}
        <button
          type="button"
          onclick={() => { step = (step + 1) as Step; }}
          disabled={(step === 1 && !role) || (step === 2 && !agentName)}
          class="px-4 py-1.5 rounded-lg bg-brand-pink text-black text-xs font-semibold hover:bg-brand-pink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {m.marketplace_wizardNext()}
        </button>
      {:else if step === 3}
        <!-- Generate button already in body -->
        <span></span>
      {:else if step === 4}
        <button
          type="button"
          onclick={() => { step = 5; }}
          class="px-4 py-1.5 rounded-lg bg-brand-pink text-black text-xs font-semibold hover:bg-brand-pink/90 transition-colors"
        >
          {m.marketplace_wizardExport()}
        </button>
      {:else}
        <button
          type="button"
          onclick={onClose}
          class="px-4 py-1.5 rounded-lg bg-brand-pink text-black text-xs font-semibold hover:bg-brand-pink/90 transition-colors"
        >
          {m.marketplace_wizardDone()}
        </button>
      {/if}
    </div>
  </div>
</div>
