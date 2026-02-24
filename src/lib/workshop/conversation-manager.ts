import { workshopState } from '$lib/state/workshop.svelte';
import { findNearbyAgents } from './proximity';
import { sendFsmEvent } from './agent-fsm';

// --- Module State ---

let banterMessageCount = 0;
let banterBudgetResetTime = Date.now() + 3600000;

let conversationCounter = 0;

/** Tracks when the last banter ended for each sessionKey (pair cooldown) */
const lastBanterEnd = new Map<string, number>();
// Banter cooldown is now read from workshopState.settings.banterCooldown

function generateConversationId(): string {
	return `conv_${Date.now()}_${conversationCounter++}`;
}

// --- Budget helpers ---

export function resetBanterBudget(): void {
	banterMessageCount = 0;
	banterBudgetResetTime = Date.now() + 3600000;
}

function checkBanterBudget(): boolean {
	if (Date.now() > banterBudgetResetTime) {
		resetBanterBudget();
	}
	return banterMessageCount < workshopState.settings.idleBanterBudgetPerHour;
}

// --- Conversation counts ---

function getActiveConversationCount(): number {
	let count = 0;
	for (const conv of Object.values(workshopState.conversations)) {
		if (conv.status === 'active') count++;
	}
	return count;
}

// --- Public API ---

export function canStartConversation(type: 'task' | 'banter'): boolean {
	const activeCount = getActiveConversationCount();
	const max = workshopState.settings.maxConcurrentConversations;

	if (type === 'task') {
		return activeCount < max;
	}

	// banter
	return (
		workshopState.settings.idleBanterEnabled &&
		checkBanterBudget() &&
		activeCount < max
	);
}

export function startConversation(
	type: 'task' | 'banter',
	participantInstanceIds: string[],
	participantAgentIds: string[],
	sessionKey: string,
	title?: string,
): string | null {
	if (!canStartConversation(type)) return null;

	// Dedup: if there's already an active conversation with this sessionKey, return it
	const existing = Object.values(workshopState.conversations).find(
		(c) => c.sessionKey === sessionKey && c.status === 'active',
	);
	if (existing) return existing.id;

	// Banter cooldown: don't re-banter the same pair too quickly
	if (type === 'banter') {
		const lastEnd = lastBanterEnd.get(sessionKey);
		if (lastEnd && Date.now() - lastEnd < workshopState.settings.banterCooldown) return null;
	}

	// Remove older completed conversations for the same agent pair to prevent duplicates.
	// Exclude 'interrupted' conversations — they are pending resume and must not be deleted.
	const pairKey = [...participantAgentIds].sort().join(':');
	for (const [oldId, oldConv] of Object.entries(workshopState.conversations)) {
		if (oldConv.status !== 'active' && oldConv.status !== 'interrupted') {
			const oldPairKey = [...oldConv.participantAgentIds].sort().join(':');
			if (oldPairKey === pairKey) {
				delete workshopState.conversations[oldId];
			}
		}
	}

	const id = generateConversationId();

	workshopState.conversations[id] = {
		id,
		type,
		participantInstanceIds,
		participantAgentIds,
		sessionKey,
		status: 'active',
		startedAt: Date.now(),
		title,
	};

	// Transition all participants to 'conversing' state
	for (const iid of participantInstanceIds) {
		sendFsmEvent(iid, 'conversationStart');
	}

	if (type === 'banter') {
		banterMessageCount++;
	}

	return id;
}

export function endConversation(conversationId: string): void {
	const conv = workshopState.conversations[conversationId];
	if (conv) {
		conv.status = 'completed';
		conv.endedAt = Date.now();

		// Track banter cooldown per pair
		if (conv.type === 'banter') {
			lastBanterEnd.set(conv.sessionKey, Date.now());
		}

		// Transition all participants out of 'conversing' state
		for (const iid of conv.participantInstanceIds) {
			sendFsmEvent(iid, 'conversationEnd');
		}
	}
}

export function checkProximityGates(): void {
	for (const conv of Object.values(workshopState.conversations)) {
		if (conv.status !== 'active') continue;

		// Keep only participants who are within proximity of at least one other participant
		const remaining = conv.participantInstanceIds.filter((id) => {
			const nearby = findNearbyAgents(id);
			return conv.participantInstanceIds.some(
				(otherId) => otherId !== id && nearby.includes(otherId)
			);
		});

		conv.participantInstanceIds = remaining;

		if (remaining.length < 2) {
			conv.status = 'completed';
		}
	}
}

export function getConversationsForAgent(instanceId: string): string[] {
	const ids: string[] = [];
	for (const conv of Object.values(workshopState.conversations)) {
		if (conv.status === 'active' && conv.participantInstanceIds.includes(instanceId)) {
			ids.push(conv.id);
		}
	}
	return ids;
}

export function isAgentInConversation(instanceId: string): boolean {
	return getConversationsForAgent(instanceId).length > 0;
}

export function findBanterCandidates(): Array<[string, string]> {
	if (!workshopState.settings.idleBanterEnabled || !checkBanterBudget()) {
		return [];
	}

	const candidates: Array<[string, string]> = [];

	for (const rel of Object.values(workshopState.relationships)) {
		const a = rel.fromInstanceId;
		const b = rel.toInstanceId;

		// Both agents must be idle (not in any active conversation)
		if (isAgentInConversation(a) || isAgentInConversation(b)) continue;

		// Both agents must be within proximity of each other
		const nearbyA = findNearbyAgents(a);
		if (!nearbyA.includes(b)) continue;

		candidates.push([a, b]);
	}

	return candidates;
}
