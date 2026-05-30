/**
 * Derive an LLM call's origin (channel + trigger source) for the reliability
 * dashboard. Prefers explicit metadata the gateway now stamps onto
 * `agent.llm.usage` events (`channel`, `source`), but FALLS BACK to parsing the
 * session key (`correlationId`) so the breakdowns work against historical events
 * emitted before the origin-telemetry gateway build shipped.
 *
 * Session keys are `agent:<agentId>:<rest>` where `rest`'s first segment is the
 * channel for channel-routed sessions (`telegram:dm:…`, `slack:channel:C1`,
 * `whatsapp:…`) or a marker (`cron:…`, `subagent:…`, `acp:…`, `main`).
 */

/** Real channel extension ids (must match gateway `extensions/<id>`). */
const KNOWN_CHANNELS = new Set([
	'telegram',
	'whatsapp',
	'discord',
	'slack',
	'signal',
	'imessage',
	'matrix',
	'line',
	'msteams',
	'googlechat',
	'irc',
	'twitch',
	'nostr',
	'feishu',
	'mattermost',
	'tlon',
	'wati',
	'zalo',
	'zalouser',
	'bluebubbles',
	'web',
	'voice',
	'sms',
	// First-party hub surfaces that initiate reactive (user-driven) runs.
	'workshop',
	'dashboard',
	'api',
	'cli',
]);

export type UsageSource = 'channel' | 'system' | 'agent' | 'unknown';

export interface UsageOrigin {
	channel: string;
	source: UsageSource;
}

/**
 * @param correlationId  the event's correlationId (gateway session key)
 * @param explicitChannel  metadata.channel if the gateway stamped it
 * @param explicitSource   metadata.source if the gateway stamped it
 */
export function deriveOrigin(
	correlationId: string | undefined,
	explicitChannel?: string,
	explicitSource?: string,
): UsageOrigin {
	let channel = explicitChannel && explicitChannel.trim() ? explicitChannel.trim() : undefined;
	let source = explicitSource && explicitSource.trim() ? (explicitSource.trim() as UsageSource) : undefined;

	if ((!channel || !source) && correlationId) {
		const parts = correlationId.split(':').filter(Boolean);
		const rest = parts[0] === 'agent' && parts.length >= 3 ? parts.slice(2) : parts;
		const head = (rest[0] ?? '').toLowerCase();

		if (head === 'cron') {
			channel ??= 'cron';
			source ??= 'system';
		} else if (head === 'subagent') {
			channel ??= 'subagent';
			source ??= 'agent';
		} else if (head === 'acp') {
			channel ??= 'acp';
			source ??= 'agent';
		} else if (KNOWN_CHANNELS.has(head)) {
			channel ??= head;
			source ??= 'channel';
		} else if (head === '' || head === 'main' || head === 'default' || head === 'dm') {
			channel ??= 'direct';
			source ??= 'unknown';
		} else {
			channel ??= head;
			source ??= 'unknown';
		}
	}

	return { channel: channel ?? 'direct', source: source ?? 'unknown' };
}
