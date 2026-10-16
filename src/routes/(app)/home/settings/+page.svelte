<script lang="ts">
  import { page } from '$app/state';
  import { personalAgent, type PersonalAgentData } from '$lib/state/features/personal-agent.svelte';
  import { conn } from '$lib/state/gateway';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import {
    configState,
    loadConfig,
    setField,
    save as saveConfig,
    isDirty,
  } from '$lib/state/config/config.svelte';
  import { detectAgentStructure } from '$lib/utils/agent-settings-schema';
  import { agentDisplayName } from '$lib/utils/agent-display';
  import { deepGet } from '$lib/utils/config-schema';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { User, MessageSquare, Clock, Zap, Plug } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, PageHeader, Spinner } from '$lib/components/ui';
  import { createAutosave } from '$lib/records/autosave.svelte';
  import { createSaveStatus, SaveOutcomeError } from '$lib/records/save-status.svelte';
  import SaveIndicator from '$lib/records/SaveIndicator.svelte';
  import { Skeleton as SharedSkeleton } from '@minion-stack/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

  // ── Data from server load ────────────────────────────────────────────────
  const serverData = $derived(
    page.data as {
      agent: PersonalAgentData | null;
      channelIdentities: Array<{
        id: string;
        channel: string;
        channelUserId: string;
        displayName: string | null;
      }>;
      userName: string;
    },
  );

  // Initialize client-side state from server data
  $effect(() => {
    if (serverData.agent) {
      personalAgent.init(serverData.agent);
    }
  });

  const agent = $derived(personalAgent.agent ?? serverData.agent);
  const isActive = $derived(agent?.provisioningStatus === 'active');
  const isPending = $derived(agent?.provisioningStatus === 'pending');
  const isProvisioning = $derived(agent?.provisioningStatus === 'provisioning');
  const isError = $derived(agent?.provisioningStatus === 'error');
  // Show gateway blocker for any non-active agent when disconnected
  const needsGateway = $derived(!conn.connected && agent && !isActive);

  // ── Local edit state ─────────────────────────────────────────────────────
  type PresetKey = 'professional' | 'casual' | 'creative' | 'technical';

  const PRESETS: Record<PresetKey, { label: () => string; preview: () => string }> = {
    professional: {
      label: () => m.myAgent_presetProfessional(),
      preview: () => m.myAgent_presetProfessionalPreview(),
    },
    casual: {
      label: () => m.myAgent_presetCasual(),
      preview: () => m.myAgent_presetCasualPreview(),
    },
    creative: {
      label: () => m.myAgent_presetCreative(),
      preview: () => m.myAgent_presetCreativePreview(),
    },
    technical: {
      label: () => m.myAgent_presetTechnical(),
      preview: () => m.myAgent_presetTechnicalPreview(),
    },
  };

  const SAMPLE_PROMPTS: Record<PresetKey, string[]> = {
    casual: [
      'What can you help me with?',
      'Tell me something interesting',
      'Help me plan my day',
      'Summarize the news',
    ],
    professional: [
      'Draft a meeting summary',
      'Review this document',
      'Create an action plan',
      'Analyze this data',
    ],
    creative: [
      'Write a short story about...',
      'Brainstorm ideas for...',
      'Design a concept for...',
      'Create a metaphor for...',
    ],
    technical: [
      'Explain how this works',
      'Debug this error',
      'Optimize this approach',
      'Compare these architectures',
    ],
  };

  let selectedPrompt = $state<string | null>(null);

  // Trigger provisioning for pending/error agents once the gateway is connected.
  // Track the last-seen status so that when it changes (e.g. after reload marks
  // the agent as 'error'), the attempt flag resets and retry becomes possible
  // without a full page refresh.
  let provisionAttempted = $state(false);
  let lastSeenStatus = $state('');
  $effect(() => {
    const currentStatus = agent?.provisioningStatus ?? '';
    if (currentStatus !== lastSeenStatus) {
      lastSeenStatus = currentStatus;
      provisionAttempted = false;
    }
  });
  $effect(() => {
    if (
      agent &&
      conn.connected &&
      !provisionAttempted &&
      (agent.provisioningStatus === 'pending' || agent.provisioningStatus === 'error')
    ) {
      provisionAttempted = true;
      personalAgent.checkAndProvision();
    }
  });

  // ── Display name lives in gateway config (agents.list[].identity.name) ──
  // Load gateway config when connected so we can read + patch identity.name.
  let configLoadAttempted = $state(false);
  $effect(() => {
    if (conn.connected && !configState.loaded && !configState.loading && !configLoadAttempted) {
      configLoadAttempted = true;
      loadConfig().catch(() => {
        // non-fatal — falls back to gw.agents (which has identity.name embedded)
      });
    }
  });

  // Resolve the agent's index in agents.list[] (for setField path)
  const agentStructure = $derived.by(() => {
    if (!agent || !configState.loaded) return null;
    return detectAgentStructure(configState.current, agent.agentId);
  });

  // Read displayName from gateway. Two sources, in priority order:
  //   1. configState (post-load) — `agents.list[idx].identity.name`
  //   2. gw.agents live event — `agent.identity.name` or legacy `agent.name`
  const gwAgent = $derived(agent ? gw.agents.find((a) => a.id === agent.agentId) : null);
  const displayNameFromGateway = $derived.by(() => {
    if (agentStructure?.type === 'list') {
      const v = deepGet(
        configState.current,
        `agents.list.${agentStructure.listIndex}.identity.name`,
      );
      if (typeof v === 'string' && v.trim()) return v;
    }
    const fromEvent = agentDisplayName(gwAgent);
    if (fromEvent && fromEvent !== agent?.agentId) return fromEvent;
    return '';
  });

  // Personality state lives in gateway config (`agents.list[].personality.*`).
  // Phase 3c — hub DB columns are deprecated; gateway is source of truth.
  const personalityFromGateway = $derived.by(() => {
    if (agentStructure?.type !== 'list') {
      return {
        text: '',
        preset: null as PresetKey | null,
        configured: false,
        conversationName: '',
      };
    }
    const base = `agents.list.${agentStructure.listIndex}.personality`;
    const text = deepGet(configState.current, `${base}.text`);
    const preset = deepGet(configState.current, `${base}.preset`);
    const configured = deepGet(configState.current, `${base}.configured`);
    const conversationName = deepGet(configState.current, `${base}.conversationName`);
    return {
      text: typeof text === 'string' ? text : '',
      preset: (typeof preset === 'string' ? preset : null) as PresetKey | null,
      configured: configured === true,
      conversationName: typeof conversationName === 'string' ? conversationName : '',
    };
  });

  const showOnboarding = $derived(agent && !personalityFromGateway.configured && isActive);

  // autosave (policy O): each field patches gateway config on its own —
  // `saveConfig` sends only the diff (`computePatch`), so fields never clobber
  // each other; one shared status drives the card's SaveIndicator.
  const saveStatus = createSaveStatus();
  function personalityBase(): string {
    if (!agentStructure || agentStructure.type !== 'list')
      throw new SaveOutcomeError('error', m.myAgent_displayNameNotReady());
    return `agents.list.${agentStructure.listIndex}`;
  }
  function prepareConfig(fields: Record<string, unknown>, isCurrent: () => boolean) {
    const base = personalityBase();
    return async () => {
      if (!isCurrent()) return;
      for (const [path, value] of Object.entries(fields)) setField(`${base}.${path}`, value);
      if (!isDirty.value) return;
      await saveConfig({ silent: true, isCurrent });
    };
  }
  const editDisplayName = createAutosave({
    committed: () => displayNameFromGateway,
    scope: () => agent?.agentId,
    prepare: (v, current) => {
      const name = v.trim();
      if (!name)
        return async () => {
          throw new SaveOutcomeError('error', m.myAgent_displayNameRequired());
        };
      return prepareConfig({ 'identity.name': name }, current);
    },
    status: saveStatus,
    keepDraftOnError: true,
  });
  const editConversationName = createAutosave({
    committed: () => personalityFromGateway.conversationName,
    scope: () => agent?.agentId,
    prepare: (v, current) =>
      prepareConfig({ 'personality.conversationName': v.trim() ? v : undefined }, current),
    status: saveStatus,
    keepDraftOnError: true,
  });
  const editPreset = createAutosave<PresetKey | null>({
    committed: () => personalityFromGateway.preset,
    scope: () => agent?.agentId,
    prepare: (v, current) =>
      prepareConfig(
        { 'personality.preset': v ?? undefined, 'personality.configured': true },
        current,
      ),
    status: saveStatus,
    debounceMs: 0,
  });
  const editPersonalityText = createAutosave({
    committed: () => personalityFromGateway.text,
    scope: () => agent?.agentId,
    prepare: (v, current) =>
      prepareConfig(
        {
          'personality.text': v.trim() ? v : undefined,
          'personality.configured': true,
        },
        current,
      ),
    status: saveStatus,
    keepDraftOnError: true,
  });

  const charCount = $derived(editPersonalityText.value.length);
  const charCountClass = $derived(
    charCount >= 500 ? 'text-destructive' : charCount >= 400 ? 'text-warning' : 'text-muted',
  );

  function selectPreset(preset: PresetKey) {
    editPreset.value = preset;
    editPersonalityText.value = PRESETS[preset].preview();
    void editPersonalityText.flush();
  }

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  const activePresetKey = $derived(editPreset.value ?? 'casual');
  const currentPrompts = $derived(SAMPLE_PROMPTS[activePresetKey] ?? SAMPLE_PROMPTS.casual);

  // Channel name formatting
  function formatChannelName(channel: string): string {
    return channel.charAt(0).toUpperCase() + channel.slice(1);
  }
</script>

<PageShell archetype="form" scroll="page" labelledBy="home-settings-title">
  <PageHeader
    titleId="home-settings-title"
    title={m.settings_title()}
    subtitle={m.nav_myAgent()}
    sticky={false}
  />
  <PageBody width="reading" padding="compact">
    <div class="w-full space-y-4">
      <!-- Gateway required: disconnected with non-active agent -->
      {#if needsGateway}
        <div class="flex flex-col items-center justify-center py-16 text-center space-y-5">
          <div
            class="w-16 h-16 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center"
          >
            <Plug size={28} class="text-accent" />
          </div>
          <div class="space-y-2 max-w-sm">
            <h2 class="text-xl font-bold text-foreground">{m.myAgent_connectTitle()}</h2>
            <p class="text-sm text-muted-foreground leading-relaxed">
              {m.myAgent_connectDesc()}
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onclick={() => (ui.overlayOpen = true)}
            class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-accent-foreground font-medium text-sm hover:brightness-110 transition-all cursor-pointer"
          >
            <Plug size={14} />
            {m.myAgent_connectHost()}
          </Button>
        </div>

        <!-- Provisioning: Pending (gateway is connected) -->
      {:else if isPending}
        <div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6">
          <div class="flex items-center gap-3">
            <SharedSkeleton shape="circle" class="w-8 h-8" />
            <div>
              <h2 class="text-base font-bold text-foreground">{m.myAgent_settingUp()}</h2>
              <p class="text-sm text-muted-foreground">{m.myAgent_settingUpDesc()}</p>
            </div>
          </div>
          <div class="mt-4">
            <SharedSkeleton shape="text" lines={3} />
          </div>
        </div>

        <!-- Provisioning: In progress -->
      {:else if isProvisioning}
        <div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6">
          <div class="flex items-center gap-3">
            <Spinner size="md" />
            <div>
              <h2 class="text-base font-bold text-foreground">{m.myAgent_creatingWorkspace()}</h2>
              <p class="text-sm text-muted-foreground">{m.myAgent_creatingWorkspaceDesc()}</p>
            </div>
          </div>
        </div>

        <!-- Provisioning: Error -->
      {:else if isError}
        <div class="bg-destructive/5 border border-destructive/20 rounded-xl p-6">
          <h2 class="text-base font-bold text-destructive">{m.myAgent_setupFailed()}</h2>
          <p class="text-sm text-muted-foreground mt-1">
            {m.myAgent_setupFailedDesc()}
          </p>
        </div>

        <!-- Active: Full page -->
      {:else if agent}
        <!-- Onboarding Banner -->
        {#if showOnboarding}
          <div class="bg-accent/5 border border-accent/20 rounded-xl p-6">
            <h1 class="text-2xl font-bold text-foreground">{m.myAgent_welcomeTitle()}</h1>
            <p class="text-sm text-muted-foreground mt-1">
              {m.myAgent_welcomeDesc()}
            </p>
          </div>
        {/if}

        <!-- Section 1: Agent Identity Card -->
        <div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 space-y-5">
          <!-- Avatar + Name -->
          <div class="flex items-start gap-4">
            <div
              class="w-16 h-16 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-lg font-bold shrink-0"
            >
              {#if agent.avatarUrl}
                <img
                  src={agent.avatarUrl}
                  alt={editDisplayName.value || agent.agentId}
                  class="w-16 h-16 rounded-full object-cover"
                />
              {:else}
                {getInitials(editDisplayName.value || 'AG')}
              {/if}
            </div>
            <div class="flex-1 min-w-0 space-y-1.5">
              <input
                type="text"
                bind:value={editDisplayName.value}
                onblur={editDisplayName.flush}
                class="w-full bg-transparent text-base font-bold text-foreground border-b border-transparent hover:border-border focus:border-accent focus:outline-none transition-colors pb-0.5"
                placeholder={m.myAgent_displayNamePlaceholder()}
                maxlength={50}
              />
              <input
                type="text"
                bind:value={editConversationName.value}
                onblur={editConversationName.flush}
                class="w-full bg-transparent text-sm text-muted-foreground border-b border-transparent hover:border-border focus:border-accent focus:outline-none transition-colors pb-0.5"
                placeholder={m.myAgent_conversationNamePlaceholder()}
              />
            </div>
          </div>

          <!-- Personality Presets -->
          <div class="space-y-3">
            <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {m.myAgent_personality()}
            </h3>
            <div class="flex flex-wrap gap-2">
              {#each Object.entries(PRESETS) as [key, preset]}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onclick={() => selectPreset(key as PresetKey)}
                  class="px-3 py-1.5 rounded-lg border text-sm font-medium cursor-pointer transition-all {editPreset.value ===
                  key
                    ? 'border-accent bg-accent/12 text-accent'
                    : 'border-border text-muted hover:text-foreground'}"
                >
                  {preset.label()}
                </Button>
              {/each}
            </div>

            <!-- Preset preview text -->
            {#if editPreset.value && PRESETS[editPreset.value]}
              <p class="text-sm text-muted-foreground italic">
                {PRESETS[editPreset.value].preview()}
              </p>
            {/if}
          </div>

          <!-- Personality Textarea -->
          <div class="space-y-1.5">
            <textarea
              bind:value={editPersonalityText.value}
              onblur={editPersonalityText.flush}
              class="w-full bg-bg2 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:border-accent transition-colors"
              rows={4}
              placeholder={m.myAgent_personalityPlaceholder()}
              maxlength={500}></textarea>
            <div class="flex justify-end">
              <span class="text-xs font-medium {charCountClass}">{charCount}/500</span>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <SaveIndicator
              status={saveStatus.status}
              message={saveStatus.message}
              onRetry={saveStatus.retry}
              onReview={() => {
                const reviewed = agent?.agentId;
                return loadConfig(() => agent?.agentId === reviewed);
              }}
            />
            {#if personalAgent.error}
              <span class="text-sm text-destructive">{personalAgent.error}</span>
            {/if}
          </div>
        </div>

        <!-- Section 2: Channels Card -->
        <div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 space-y-3">
          <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {m.myAgent_channels()}
          </h3>
          {#if serverData.channelIdentities.length > 0}
            <div class="space-y-2">
              {#each serverData.channelIdentities as identity}
                <div class="flex items-center gap-3 py-2 px-3 rounded-lg bg-bg2/50">
                  <div class="w-2 h-2 rounded-full bg-success shrink-0"></div>
                  <span class="text-sm font-medium text-foreground"
                    >{formatChannelName(identity.channel)}</span
                  >
                  {#if identity.displayName}
                    <span class="text-xs text-muted-foreground">({identity.displayName})</span>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="py-4 text-center">
              <p class="text-sm text-muted-foreground">{m.myAgent_noChannels()}</p>
              <p class="text-xs text-muted-foreground mt-1">{m.myAgent_noChannelsDesc()}</p>
            </div>
          {/if}
        </div>

        <!-- Section 3: Activity Card -->
        <div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 space-y-4">
          <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {m.myAgent_activity()}
          </h3>

          <!-- Stats row -->
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-1.5">
              <MessageSquare size={14} class="text-muted" />
              <span class="text-xs font-medium text-muted">{m.myAgent_zeroMessages()}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <Zap size={14} class="text-muted" />
              <span class="text-xs font-medium text-muted">{m.myAgent_zeroSessions()}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <Clock size={14} class="text-muted" />
              <span class="text-xs font-medium text-muted">{m.myAgent_never()}</span>
            </div>
          </div>

          <!-- Sample Prompts -->
          <div class="space-y-3">
            <p class="text-xs text-muted-foreground">
              {#if personalityFromGateway.configured}
                {m.myAgent_tryAsking()}
              {:else}
                {m.myAgent_noActivity()}
              {/if}
            </p>
            <div class="flex flex-wrap gap-2">
              {#each currentPrompts as prompt}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onclick={() => {
                    selectedPrompt = selectedPrompt === prompt ? null : prompt;
                  }}
                  class="bg-bg3 border rounded-xl px-4 py-2.5 text-sm text-muted hover:text-foreground transition-all cursor-pointer {selectedPrompt ===
                  prompt
                    ? 'border-accent text-foreground'
                    : 'border-border hover:border-muted-foreground'}"
                >
                  {prompt}
                </Button>
              {/each}
            </div>

            {#if selectedPrompt}
              <div class="bg-bg2/50 rounded-lg p-4 border border-border/50">
                <p class="text-sm text-foreground">
                  {m.myAgent_previewPrompt()}
                </p>
              </div>
            {/if}
          </div>
        </div>

        <!-- No agent at all -->
      {:else}
        <div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 text-center">
          <User size={32} class="text-muted mx-auto mb-3" />
          <h2 class="text-base font-bold text-foreground">{m.myAgent_noAgent()}</h2>
          <p class="text-sm text-muted-foreground mt-1">{m.myAgent_noAgentDesc()}</p>
        </div>
      {/if}
    </div>
  </PageBody>
</PageShell>
