<script lang="ts">
	import { Mail, CalendarDays } from 'lucide-svelte';
	import { providerMeta, type ProviderKey } from './provider';

	interface Props {
		provider: ProviderKey;
		size?: number;
		/** 'mail' → inbox brand mark; 'calendar' → the provider's calendar mark. */
		variant?: 'mail' | 'calendar';
	}
	const { provider, size = 13, variant = 'mail' }: Props = $props();
	const meta = $derived(providerMeta(provider));
	// Calendar brand accents differ from the mail ones (Gmail red → Google blue).
	const CAL_COLOR: Record<ProviderKey, string> = {
		gmail: '#4285F4',
		outlook: '#0078D4',
		apple: '#A2AAAD',
		mail: 'var(--color-accent)',
	};
	const color = $derived(variant === 'calendar' ? CAL_COLOR[provider] : meta.color);
	const label = $derived(
		variant === 'calendar'
			? provider === 'gmail'
				? 'Google Calendar'
				: `${meta.label} Calendar`
			: meta.label,
	);
</script>

<span class="prov" title={label} style="--brand:{color}; width:{size}px; height:{size}px;">
	{#if variant === 'calendar'}
		<CalendarDays size={size} />
	{:else if provider === 'gmail'}
		<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
			<path
				d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
			/>
		</svg>
	{:else if provider === 'apple'}
		<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
			<path
				d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
			/>
		</svg>
	{:else if provider === 'outlook'}
		<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
			<path
				d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.33.59-.52.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.86zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V10.85l1.24.72h.01q.1.07.18.18.07.12.07.25zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.03l2.41 1.5 1.34-.8v-2.73zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.19-.86.48-.55.73-1.3.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.31-1.21.86-.5.54-.77 1.3-.26.74-.26 1.63 0 .85.26 1.56.26.72.74 1.24.48.52 1.17.81.69.3 1.56.3zM7.5 21h12.39L12 16.08V17q0 .41-.3.7-.29.3-.7.3H7.5z"
			/>
		</svg>
	{:else}
		<Mail size={size} />
	{/if}
</span>

<style>
	.prov {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--brand);
		flex-shrink: 0;
	}
	.prov svg {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
