<script lang="ts">
	import { page } from '$app/state';
	import { personalAgent, type PersonalAgentData } from '$lib/state/features/personal-agent.svelte';
	import { conn } from '$lib/state/gateway';
	import { User, Save, Loader2, MessageSquare, Clock, Zap } from 'lucide-svelte';

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
	const showOnboarding = $derived(agent && !agent.personalityConfigured && isActive);

	// ── Local edit state ─────────────────────────────────────────────────────
	type PresetKey = 'professional' | 'casual' | 'creative' | 'technical';

	const PRESETS: Record<PresetKey, { label: string; preview: string }> = {
		professional: {
			label: 'Professional',
			preview: 'Clear, structured responses with a focus on accuracy and efficiency.',
		},
		casual: {
			label: 'Casual',
			preview: 'Friendly and conversational, like chatting with a helpful friend.',
		},
		creative: {
			label: 'Creative',
			preview: 'Imaginative and expressive, with a flair for creative solutions.',
		},
		technical: {
			label: 'Technical',
			preview: 'Precise and detail-oriented, with deep technical explanations.',
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

	// Trigger provisioning for pending/error agents once the gateway is connected
	let provisionAttempted = $state(false);
	$effect(() => {
		if (agent && conn.connected && !provisionAttempted && (agent.provisioningStatus === 'pending' || agent.provisioningStatus === 'error')) {
			provisionAttempted = true;
			personalAgent.checkAndProvision();
		}
	});

	// Initialize edit fields from agent data
	$effect(() => {
		if (agent && !initialized) {
			editDisplayName = agent.displayName ?? '';
			editConversationName = agent.conversationName ?? '';
			editPreset = (agent.personalityPreset as PresetKey) ?? null;
			editPersonalityText = agent.personalityText ?? '';
			initialized = true;
		}
	});

	const charCount = $derived(editPersonalityText.length);
	const charCountClass = $derived(
		charCount >= 500 ? 'text-destructive' : charCount >= 400 ? 'text-warning' : 'text-muted',
	);

	const hasChanges = $derived(
		agent != null &&
			(editDisplayName !== (agent.displayName ?? '') ||
				editConversationName !== (agent.conversationName ?? '') ||
				editPreset !== (agent.personalityPreset ?? null) ||
				editPersonalityText !== (agent.personalityText ?? '')),
	);

	function selectPreset(preset: PresetKey) {
		editPreset = preset;
		editPersonalityText = PRESETS[preset].preview;
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
		if (!hasChanges || personalAgent.saving) return;
		const updates: Partial<PersonalAgentData> = {};
		if (editDisplayName !== (agent?.displayName ?? '')) updates.displayName = editDisplayName;
		if (editConversationName !== (agent?.conversationName ?? ''))
			updates.conversationName = editConversationName || null;
		if (editPreset !== (agent?.personalityPreset ?? null))
			updates.personalityPreset = editPreset;
		if (editPersonalityText !== (agent?.personalityText ?? ''))
			updates.personalityText = editPersonalityText || null;
		if (editPreset || editPersonalityText)
			updates.personalityConfigured = true;

		await personalAgent.save(updates);

		if (!personalAgent.error) {
			saveSuccess = true;
			setTimeout(() => { saveSuccess = false; }, 2000);
		}
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

	const activePresetKey = $derived(editPreset ?? (agent?.personalityPreset as PresetKey) ?? 'casual');
	const currentPrompts = $derived(SAMPLE_PROMPTS[activePresetKey] ?? SAMPLE_PROMPTS.casual);

	// Channel name formatting
	function formatChannelName(channel: string): string {
		return channel.charAt(0).toUpperCase() + channel.slice(1);
	}
</script>

<div class="flex flex-col flex-1 overflow-y-auto">
	<div class="w-full max-w-2xl mx-auto px-4 py-6 space-y-4">

		<!-- Provisioning: Pending -->
		{#if isPending}
			<div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6">
				<div class="flex items-center gap-3">
					<div class="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center animate-pulse">
						<Loader2 size={16} class="text-warning animate-spin" />
					</div>
					<div>
						<h2 class="text-[17px] font-bold text-foreground">Setting up your agent</h2>
						<p class="text-sm text-muted-foreground">Your personal agent is being created. This usually takes a few seconds.</p>
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
						<h2 class="text-[17px] font-bold text-foreground">Creating workspace...</h2>
						<p class="text-sm text-muted-foreground">Almost ready. Setting up your agent workspace.</p>
					</div>
				</div>
			</div>

		<!-- Provisioning: Error -->
		{:else if isError}
			<div class="bg-destructive/5 border border-destructive/20 rounded-xl p-6">
				<h2 class="text-[17px] font-bold text-destructive">Agent setup failed</h2>
				<p class="text-sm text-muted-foreground mt-1">
					It will retry automatically. If this persists, contact your admin.
				</p>
			</div>

		<!-- Active: Full page -->
		{:else if agent}

			<!-- Onboarding Banner -->
			{#if showOnboarding}
				<div class="bg-accent/5 border border-accent/20 rounded-xl p-6">
					<h1 class="text-2xl font-bold text-foreground">Welcome to your personal agent</h1>
					<p class="text-sm text-muted-foreground mt-1">
						Pick a personality to get started, or just say hello in any channel.
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
							<img src={agent.avatarUrl} alt={agent.displayName} class="w-16 h-16 rounded-full object-cover" />
						{:else}
							{getInitials(editDisplayName || agent.displayName || 'AG')}
						{/if}
					</div>
					<div class="flex-1 min-w-0 space-y-1.5">
						<input
							type="text"
							value={editDisplayName}
							oninput={handleDisplayNameInput}
							class="w-full bg-transparent text-[17px] font-bold text-foreground border-b border-transparent hover:border-border focus:border-accent focus:outline-none transition-colors pb-0.5"
							placeholder="Display name"
							maxlength={50}
						/>
						<input
							type="text"
							bind:value={editConversationName}
							class="w-full bg-transparent text-sm text-muted-foreground border-b border-transparent hover:border-border focus:border-accent focus:outline-none transition-colors pb-0.5"
							placeholder="Conversation name (optional)"
						/>
					</div>
				</div>

				<!-- Personality Presets -->
				<div class="space-y-3">
					<h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Personality</h3>
					<div class="flex flex-wrap gap-2">
						{#each Object.entries(PRESETS) as [key, preset]}
							<button
								type="button"
								onclick={() => selectPreset(key as PresetKey)}
								class="px-3 py-1.5 rounded-lg border text-sm font-medium cursor-pointer transition-all {editPreset === key
									? 'border-accent bg-accent/12 text-accent'
									: 'border-border text-muted hover:text-foreground'}"
							>
								{preset.label}
							</button>
						{/each}
					</div>

					<!-- Preset preview text -->
					{#if editPreset && PRESETS[editPreset]}
						<p class="text-sm text-muted-foreground italic">
							{PRESETS[editPreset].preview}
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
						placeholder="Describe your agent's personality, tone, and style..."
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
						disabled={!hasChanges || personalAgent.saving}
						class="bg-accent text-accent-foreground px-4 py-2 rounded-lg font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 flex items-center gap-2"
					>
						{#if personalAgent.saving}
							<Loader2 size={14} class="animate-spin" />
							Saving...
						{:else if saveSuccess}
							Saved
						{:else}
							<Save size={14} />
							Save Changes
						{/if}
					</button>

					{#if personalAgent.error}
						<span class="text-sm text-destructive">{personalAgent.error}</span>
					{/if}
				</div>
			</div>

			<!-- Section 2: Channels Card -->
			<div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 space-y-3">
				<h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Channels</h3>
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
						<p class="text-sm text-muted-foreground">No channels linked</p>
						<p class="text-xs text-muted-foreground mt-1">Your admin can link messaging channels to your agent.</p>
					</div>
				{/if}
			</div>

			<!-- Section 3: Activity Card -->
			<div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 space-y-4">
				<h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Activity</h3>

				<!-- Stats row -->
				<div class="flex items-center gap-6">
					<div class="flex items-center gap-1.5">
						<MessageSquare size={14} class="text-muted" />
						<span class="text-[11px] font-medium text-muted">0 messages</span>
					</div>
					<div class="flex items-center gap-1.5">
						<Zap size={14} class="text-muted" />
						<span class="text-[11px] font-medium text-muted">0 sessions</span>
					</div>
					<div class="flex items-center gap-1.5">
						<Clock size={14} class="text-muted" />
						<span class="text-[11px] font-medium text-muted">Never</span>
					</div>
				</div>

				<!-- Sample Prompts -->
				<div class="space-y-3">
					<p class="text-xs text-muted-foreground">
						{#if agent.personalityConfigured}
							Try asking your agent:
						{:else}
							No activity yet. Send your first message to get started. Try one of the prompts below.
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
								This is a preview prompt. Connect to a gateway to start chatting with your agent.
							</p>
						</div>
					{/if}
				</div>
			</div>

		<!-- No agent at all -->
		{:else}
			<div class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 text-center">
				<User size={32} class="text-muted mx-auto mb-3" />
				<h2 class="text-[17px] font-bold text-foreground">No personal agent</h2>
				<p class="text-sm text-muted-foreground mt-1">Your personal agent will be created automatically.</p>
			</div>
		{/if}

	</div>
</div>
