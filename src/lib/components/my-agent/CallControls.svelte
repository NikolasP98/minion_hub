<script lang="ts">
	import { Phone, PhoneOff, Mic, MicOff } from 'lucide-svelte';
	import type { AgentVoiceState } from '$lib/voice/visemeMap';

	interface Props {
		active: boolean;
		muted: boolean;
		status: AgentVoiceState;
		disabled?: boolean;
		onstart: () => void;
		onend: () => void;
		ontoggleMute: () => void;
	}

	const { active, muted, status, disabled = false, onstart, onend, ontoggleMute }: Props = $props();

	const STATUS_LABEL: Record<AgentVoiceState, string> = {
		idle: 'Muted',
		listening: 'Listening…',
		thinking: 'Thinking…',
		speaking: 'Speaking…',
	};
</script>

{#if !active}
	<button
		type="button"
		class="call-btn start"
		{disabled}
		onclick={onstart}
		aria-label="Call your agent"
		title={disabled ? 'Connect a gateway first' : 'Call your agent'}
	>
		<Phone size={14} />
		<span class="label">Call agent</span>
	</button>
{:else}
	<div class="call-live" role="group" aria-label="Call controls">
		<span class="status" data-status={status}>
			<span class="pulse" class:on={status === 'listening' || status === 'speaking'}></span>
			{STATUS_LABEL[status]}
		</span>
		<button
			type="button"
			class="icon-btn"
			class:muted
			onclick={ontoggleMute}
			title={muted ? 'Unmute' : 'Mute'}
			aria-pressed={muted}
		>
			{#if muted}<MicOff size={14} />{:else}<Mic size={14} />{/if}
		</button>
		<button type="button" class="icon-btn end" onclick={onend} title="End call">
			<PhoneOff size={14} />
		</button>
	</div>
{/if}

<style>
	.call-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 14px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
		transition: background 120ms ease, border-color 120ms ease;
	}
	.call-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
	}
	.call-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.call-btn:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.call-live {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.pulse {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-foreground) 30%, transparent);
	}
	.pulse.on {
		background: #4ade80;
		box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5);
		animation: pulse 1.4s infinite;
	}

	.icon-btn {
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		cursor: pointer;
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
		color: var(--color-foreground);
		transition: background 120ms ease;
	}
	.icon-btn:hover {
		background: color-mix(in srgb, var(--color-foreground) 10%, transparent);
	}
	.icon-btn.muted {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
	.icon-btn.end {
		color: #f87171;
		border-color: rgba(248, 113, 113, 0.4);
		background: rgba(248, 113, 113, 0.1);
	}
	.icon-btn.end:hover {
		background: rgba(248, 113, 113, 0.2);
	}

	/* When the agent column gets narrow (e.g. the notes panel is open), drop the
	   "Call agent" label so the control stays a compact icon button instead of
	   squeezing the greeting. The container is declared on .inner in +page.svelte. */
	@container agentcol (max-width: 460px) {
		.call-btn {
			padding: 8px;
			gap: 0;
		}
		.call-btn .label {
			display: none;
		}
	}

	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5);
		}
		70% {
			box-shadow: 0 0 0 6px rgba(74, 222, 128, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
		}
	}
</style>
