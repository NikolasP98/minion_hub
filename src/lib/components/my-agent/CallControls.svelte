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
		title={disabled ? 'Connect a gateway first' : 'Call your agent'}
	>
		<Phone size={14} />
		<span>Call agent</span>
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
		border: 1px solid rgba(232, 125, 106, 0.45);
		background: rgba(232, 125, 106, 0.12);
		color: #f0a594;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.call-btn:hover:not(:disabled) {
		background: rgba(232, 125, 106, 0.2);
		border-color: rgba(232, 125, 106, 0.7);
	}
	.call-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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
		color: rgba(255, 255, 255, 0.7);
		font-variant-numeric: tabular-nums;
	}

	.pulse {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.3);
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
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.04);
		color: rgba(255, 255, 255, 0.8);
		transition: background 120ms ease;
	}
	.icon-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}
	.icon-btn.muted {
		color: #f0a594;
		border-color: rgba(232, 125, 106, 0.5);
		background: rgba(232, 125, 106, 0.12);
	}
	.icon-btn.end {
		color: #f87171;
		border-color: rgba(248, 113, 113, 0.4);
		background: rgba(248, 113, 113, 0.1);
	}
	.icon-btn.end:hover {
		background: rgba(248, 113, 113, 0.2);
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
