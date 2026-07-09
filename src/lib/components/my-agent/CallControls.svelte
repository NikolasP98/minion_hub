<script lang="ts">
	import * as m from '$lib/paraglide/messages';
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
		idle: m.call_muted(),
		listening: m.call_listening(),
		thinking: m.call_thinking(),
		speaking: m.call_speaking(),
	};
</script>

{#if !active}
	<button
		type="button"
		class="call-btn start"
		{disabled}
		onclick={onstart}
		aria-label={m.call_callYourAgent()}
		title={disabled ? m.call_connectGatewayFirst() : m.call_callYourAgent()}
	>
		<Phone size={16} />
	</button>
{:else}
	<div class="call-live" role="group" aria-label={m.call_callControls()}>
		<span class="status" data-status={status}>
			<span class="pulse" class:on={status === 'listening' || status === 'speaking'}></span>
			{STATUS_LABEL[status]}
		</span>
		<button
			type="button"
			class="icon-btn"
			class:muted
			onclick={ontoggleMute}
			title={muted ? m.call_unmute() : m.call_mute()}
			aria-pressed={muted}
		>
			{#if muted}<MicOff size={14} />{:else}<Mic size={14} />{/if}
		</button>
		<button type="button" class="icon-btn end" onclick={onend} title={m.call_endCall()}>
			<PhoneOff size={14} />
		</button>
	</div>
{/if}

<style>
	.call-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* Icon-only, compact square — matches the chat input box height + radius. */
		width: 40px;
		height: 40px;
		padding: 0;
		border-radius: 8px;
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
