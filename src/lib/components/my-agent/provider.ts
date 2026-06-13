/**
 * Map a linked account's email address to its mail/calendar *provider* so the
 * feed can show a small branded badge per section (Gmail / Outlook / Apple).
 *
 * The Google pullers are the only live source today, but a user may link
 * several identities, and the domain is the most reliable signal we have on the
 * client. Unknown domains fall back to a generic "mail" mark.
 */

export type ProviderKey = 'gmail' | 'outlook' | 'apple' | 'mail';

export interface ProviderMeta {
	key: ProviderKey;
	label: string;
	/** Brand accent used to tint the badge. */
	color: string;
}

const PROVIDERS: Record<ProviderKey, ProviderMeta> = {
	gmail: { key: 'gmail', label: 'Gmail', color: '#EA4335' },
	outlook: { key: 'outlook', label: 'Outlook', color: '#0078D4' },
	apple: { key: 'apple', label: 'Apple', color: '#A2AAAD' },
	mail: { key: 'mail', label: 'Mail', color: 'var(--color-accent)' },
};

const OUTLOOK_DOMAINS = new Set([
	'outlook.com',
	'hotmail.com',
	'live.com',
	'msn.com',
	'outlook.es',
	'hotmail.es',
]);
const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);

export function providerKey(email: string | null | undefined): ProviderKey {
	const domain = (email ?? '').split('@')[1]?.toLowerCase().trim();
	if (!domain) return 'mail';
	if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail';
	if (OUTLOOK_DOMAINS.has(domain)) return 'outlook';
	if (APPLE_DOMAINS.has(domain)) return 'apple';
	// Workspace/custom Google domains still flow through the Gmail pullers, so a
	// non-consumer domain is far more likely Gmail-backed than anything else.
	return 'gmail';
}

export function providerMeta(key: ProviderKey): ProviderMeta {
	return PROVIDERS[key];
}

/**
 * Distinct provider keys across a set of source identities, in a stable order
 * (gmail → outlook → apple → mail) so the header badges don't reshuffle.
 */
export function distinctProviders(emails: Array<string | null | undefined>): ProviderKey[] {
	const seen = new Set<ProviderKey>();
	for (const e of emails) seen.add(providerKey(e));
	const order: ProviderKey[] = ['gmail', 'outlook', 'apple', 'mail'];
	return order.filter((k) => seen.has(k));
}
