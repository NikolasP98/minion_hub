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
	import { User, Save, Loader2, MessageSquare, Clock, Zap, Plug } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	// ── Data from server load ────────────────────────────────────────────────
	const serverData = $derived(page.data as {
		agent: PersonalAgentData | null;
		channelIdentities: Array<{ id: string; channel: string; channelUserId: string; displayName: string | null }>;
		userName: string;
	});

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
		casual: ['What can you help me with?', 'Tell me something interesting', 'Help me plan my day', 'Summarize the news'],
		professional: ['Draft a meeting summary', 'Review this document', 'Create an action plan', 'Analyze this data'],
		creative: ['Write a short story about...', 'Brainstorm ideas for...', 'Design a concept for...', 'Create a metaphor for...'],
		technical: ['Explain how this works', 'Debug this error', 'Optimize this approach', 'Compare these architectures'],
	};

	let editDisplayName = $state('');
	let editConversationName = $state('');
	let editPreset = $state<PresetKey | null>(null);
	let editPersonalityText = $state('');
	let initialized = $state(false);
	let selectedPrompt = $state<string | null>(null);
	let saveSuccess = $state(false);

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
		if (agent && conn.connected && !provisionAttempted && (agent.provisioningStatus === 'pending' || agent.provisioningStatus === 'error')) {
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
			return { text: '', preset: null as PresetKey | null, configured: false, conversationName: '' };
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

	// Initialize edit fields from gateway state once we have it.
	$effect(() => {
		if (agent && !initialized && configState.loaded) {
			editDisplayName = displayNameFromGateway;
			editConversationName = personalityFromGateway.conversationName;
			editPreset = personalityFromGateway.preset;
			editPersonalityText = personalityFromGateway.text;
			initialized = true;
		}
	});

	const charCount = $derived(editPersonalityText.length);
	const charCountClass = $derived(
		charCount >= 500 ? 'text-destructive' : charCount >= 400 ? 'text-warning' : 'text-muted',
	);

	const hasChanges = $derived(
		agent != null &&
			(editDisplayName !== displayNameFromGateway ||
				editConversationName !== personalityFromGateway.conversationName ||
				editPreset !== personalityFromGateway.preset ||
				editPersonalityText !== personalityFromGateway.text),
	);

	// Local saving state for the gateway side (config.patch). Combined with
	// personalAgent.saving for the DB side to drive the UI button.
	let savingDisplayName = $state(false);
	const isSaving = $derived(personalAgent.saving || savingDisplayName);
	let displayNameError = $state<string | null>(null);

	function selectPreset(preset: PresetKey) {
		editPreset = preset;
		editPersonalityText = PRESETS[preset].preview();
	}

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	async function handleSave() {
		if (!hasChanges || isSaving) return;
		displayNameError = null;

		// 1. Display name → gateway config (`agents.list[idx].identity.name`)
		//    via the same `config.patch` RPC the AgentSettingsPanel uses.
		const newDisplay = editDisplayName.trim();
		if (newDisplay !== displayNameFromGateway) {
			if (!newDisplay) {
				displayNameError = m.myAgent_displayNameRequired();
				return;
			}
			if (!agentStructure || agentStructure.type !== 'list') {
				displayNameError = m.myAgent_displayNameNotReady();
				return;
			}
			savingDisplayName = true;
			try {
				setField(`agents.list.${agentStructure.listIndex}.identity.name`, newDisplay);
				const ok = await saveConfig();
				if (!ok) {
					displayNameError = m.myAgent_displayNameSaveFailed();
					return;
				}
			} catch (e) {
				displayNameError = (e as Error).message ?? m.myAgent_displayNameSaveFailed();
				return;
			} finally {
				savingDisplayName = false;
			}
		}

		// 2. Personality + conversationName → gateway config
		//    (`agents.list[idx].personality.*`). Phase 3c — gateway is the
		//    sole source of truth; hub DB columns are deprecated.
		if (agentStructure && agentStructure.type === 'list') {
			const base = `agents.list.${agentStructure.listIndex}.personality`;
			let personalityChanged = false;

			const newText = editPersonalityText.trim();
			if (newText !== personalityFromGateway.text) {
				setField(`${base}.text`, newText ? editPersonalityText : undefined);
				personalityChanged = true;
			}

			if (editPreset !== personalityFromGateway.preset) {
				setField(`${base}.preset`, editPreset ?? undefined);
				personalityChanged = true;
			}

			if (personalityChanged) {
				setField(`${base}.configured`, true);
			}

			const newConv = editConversationName.trim();
			if (newConv !== personalityFromGateway.conversationName) {
				setField(`${base}.conversationName`, newConv ? editConversationName : undefined);
			}

			if (isDirty.value) {
				savingDisplayName = true;
				try {
					const ok = await saveConfig();
					if (!ok) {
						displayNameError = m.myAgent_displayNameSaveFailed();
						return;
					}
				} catch (e) {
					displayNameError = (e as Error).message ?? m.myAgent_displayNameSaveFailed();
					return;
				} finally {
					savingDisplayName = false;
				}
			}
		}

		saveSuccess = true;
		setTimeout(() => {
			saveSuccess = false;
		}, 2000);
	}

	function handlePersonalityInput(e: Event) {
		const target = e.target as HTMLTextAreaElement;
		if (target.value.length <= 500) {
			editPersonalityText = target.value;
		}
	}

	function handleDisplayNameInput(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.value.length <= 50) {
			editDisplayName = target.value;
		}
	}

	const activePresetKey = $derived(editPreset ?? personalityFromGateway.preset ?? 'casual');
	const currentPrompts = $derived(SAMPLE_PROMPTS[activePresetKey] ?? SAMPLE_PROMPTS.casual);

	// Channel name formatting
	function formatChannelName(channel: string): string {
		return channel.charAt(0).toUpperCase() + channel.slice(1);
	}
</script>

<div class="flex flex-col flex-1 overflow-y-auto">
	<div class="w-full max-w-2xl mx-auto px-4 py-6 space-y-4">

		<!-- Gateway required: disconnected with non-active agent -->
		{#if needsGateway}
			<div class="flex flex-col items-center justify-center py-16 text-center space-y-5">
				<div class="w-16 h-16 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
					<Plug size={28} class="text-accent" />
				</div>
				<div class="space-y-2 max-w-sm">
					<h2 class="text-xl font-bold text-foreground">{m.myAgent_connectTitle()}</h2>
					<p class="text-sm text-muted-foreground leading-relaxed">
						{m.myAgent_connectDesc()}
					</p>
				</div>
				<button
					type="button"
					onclick={() => (ui.overlayOpen = true)}
					class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-accent-foreground font-medium text-sm hover:brightness-110 transition-all cursor-pointer"
				>
					<Plug size={14} />
					{m.myAgent_connectHost()}
				</button>
			</div>

		<!-- Provisioning: Pending (gateway is connected) -->
		{:else if isPending}
			<div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6">
				<div class="flex items-center gap-3">
					<div class="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center animate-pulse">
						<Loader2 size={16} class="text-warning animate-spin" />
					</div>
					<div>
						<h2 class="text-[17px] font-bold text-foreground">{m.myAgent_settingUp()}</h2>
						<p class="text-sm text-muted-foreground">{m.myAgent_settingUpDesc()}</p>
					</div>
				</div>
				<div class="mt-4 space-y-3">
					<div class="h-4 bg-bg3 rounded animate-pulse"></div>
					<div class="h-4 bg-bg3 rounded animate-pulse w-3/4"></div>
					<div class="h-4 bg-bg3 rounded animate-pulse w-1/2"></div>
				</div>
			</div>

		<!-- Provisioning: In progress -->
		{:else if isProvisioning}
			<div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6">
				<div class="flex items-center gap-3">
					<Loader2 size={20} class="text-accent animate-spin" />
					<div>
						<h2 class="text-[17px] font-bold text-foreground">{m.myAgent_creatingWorkspace()}</h2>
						<p class="text-sm text-muted-foreground">{m.myAgent_creatingWorkspaceDesc()}</p>
					</div>
				</div>
			</div>

		<!-- Provisioning: Error -->
		{:else if isError}
			<div class="bg-destructive/5 border border-destructive/20 rounded-xl p-6">
				<h2 class="text-[17px] font-bold text-destructive">{m.myAgent_setupFailed()}</h2>
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
							<img src={agent.avatarUrl} alt={editDisplayName || agent.agentId} class="w-16 h-16 rounded-full object-cover" />
						{:else}
							{getInitials(editDisplayName || displayNameFromGateway || 'AG')}
						{/if}
					</div>
					<div class="flex-1 min-w-0 space-y-1.5">
						<input
							type="text"
							value={editDisplayName}
							oninput={handleDisplayNameInput}
							class="w-full bg-transparent text-[17px] font-bold text-foreground border-b border-transparent hover:border-border focus:border-accent focus:outline-none transition-colors pb-0.5"
							placeholder={m.myAgent_displayNamePlaceholder()}
							maxlength={50}
						/>
						<input
							type="text"
							bind:value={editConversationName}
							class="w-full bg-transparent text-sm text-muted-foreground border-b border-transparent hover:border-border focus:border-accent focus:outline-none transition-colors pb-0.5"
							placeholder={m.myAgent_conversationNamePlaceholder()}
						/>
					</div>
				</div>

				<!-- Personality Presets -->
				<div class="space-y-3">
					<h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{m.myAgent_personality()}</h3>
					<div class="flex flex-wrap gap-2">
						{#each Object.entries(PRESETS) as [key, preset]}
							<button
								type="button"
								onclick={() => selectPreset(key as PresetKey)}
								class="px-3 py-1.5 rounded-lg border text-sm font-medium cursor-pointer transition-all {editPreset === key
									? 'border-accent bg-accent/12 text-accent'
									: 'border-border text-muted hover:text-foreground'}"
							>
								{preset.label()}
							</button>
						{/each}
					</div>

					<!-- Preset preview text -->
					{#if editPreset && PRESETS[editPreset]}
						<p class="text-sm text-muted-foreground italic">
							{PRESETS[editPreset].preview()}
						</p>
					{/if}
				</div>

				<!-- Personality Textarea -->
				<div class="space-y-1.5">
					<textarea
						value={editPersonalityText}
						oninput={handlePersonalityInput}
						class="w-full bg-bg2 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:border-accent transition-colors"
						rows={4}
						placeholder={m.myAgent_personalityPlaceholder()}
						maxlength={500}
					></textarea>
					<div class="flex justify-end">
						<span class="text-[11px] font-medium {charCountClass}">{charCount}/500</span>
					</div>
				</div>

				<!-- Save Button -->
				<div class="flex items-center gap-3">
					<button
						type="button"
						onclick={handleSave}
						disabled={!hasChanges || isSaving}
						class="bg-accent text-accent-foreground px-4 py-2 rounded-lg font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 flex items-center gap-2"
					>
						{#if isSaving}
							<Loader2 size={14} class="animate-spin" />
							{m.myAgent_saving()}
						{:else if saveSuccess}
							{m.myAgent_saved()}
						{:else}
							<Save size={14} />
							{m.myAgent_saveChanges()}
						{/if}
					</button>

					{#if displayNameError}
						<span class="text-sm text-destructive">{displayNameError}</span>
					{:else if personalAgent.error}
						<span class="text-sm text-destructive">{personalAgent.error}</span>
					{/if}
				</div>
			</div>

			<!-- Section 2: Channels Card -->
			<div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 space-y-3">
				<h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{m.myAgent_channels()}</h3>
				{#if serverData.channelIdentities.length > 0}
					<div class="space-y-2">
						{#each serverData.channelIdentities as identity}
							<div class="flex items-center gap-3 py-2 px-3 rounded-lg bg-bg2/50">
								<div class="w-2 h-2 rounded-full bg-success shrink-0"></div>
								<span class="text-sm font-medium text-foreground">{formatChannelName(identity.channel)}</span>
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
				<h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{m.myAgent_activity()}</h3>

				<!-- Stats row -->
				<div class="flex items-center gap-6">
					<div class="flex items-center gap-1.5">
						<MessageSquare size={14} class="text-muted" />
						<span class="text-[11px] font-medium text-muted">{m.myAgent_zeroMessages()}</span>
					</div>
					<div class="flex items-center gap-1.5">
						<Zap size={14} class="text-muted" />
						<span class="text-[11px] font-medium text-muted">{m.myAgent_zeroSessions()}</span>
					</div>
					<div class="flex items-center gap-1.5">
						<Clock size={14} class="text-muted" />
						<span class="text-[11px] font-medium text-muted">{m.myAgent_never()}</span>
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
							<button
								type="button"
								onclick={() => { selectedPrompt = selectedPrompt === prompt ? null : prompt; }}
								class="bg-bg3 border rounded-xl px-4 py-2.5 text-sm text-muted hover:text-foreground transition-all cursor-pointer {selectedPrompt === prompt
									? 'border-accent text-foreground'
									: 'border-border hover:border-muted-foreground'}"
							>
								{prompt}
							</button>
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
				<h2 class="text-[17px] font-bold text-foreground">{m.myAgent_noAgent()}</h2>
				<p class="text-sm text-muted-foreground mt-1">{m.myAgent_noAgentDesc()}</p>
			</div>
		{/if}

	</div>
</div>
