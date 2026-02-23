/**
 * Inbox Bridge
 *
 * Routes messages between agents via their inbox elements on the workshop canvas.
 * Provides a high-level API for sending messages that automatically updates both
 * the sender's outbox and receiver's inbox.
 */

import {
	workshopState,
	addInboxItem,
	addOutboxItem,
	autoSave,
	type InboxItem,
} from '$lib/state/workshop.svelte';

/**
 * Send a message from one agent (or user) to another, routing through
 * their inbox/outbox elements on the canvas.
 *
 * 1. Creates an InboxItem with a unique ID and timestamp
 * 2. Adds to target agent's inbox element (inboxItems)
 * 3. Adds to sender's inbox element (outboxItems)
 * 4. Triggers auto-save
 *
 * @returns The created item ID, or null if no matching inbox elements exist.
 */
export function sendInboxMessage(
	fromId: string,
	toId: string,
	content: string,
): string | null {
	// Find inbox element for the target agent
	const targetInbox = Object.values(workshopState.elements).find(
		(el) => el.type === 'inbox' && el.inboxAgentId === toId,
	);

	// Find inbox element for the sender (for outbox tracking)
	const senderInbox = Object.values(workshopState.elements).find(
		(el) => el.type === 'inbox' && el.inboxAgentId === fromId,
	);

	if (!targetInbox && !senderInbox) return null;

	const itemBase: Omit<InboxItem, 'id'> = {
		fromId,
		toId,
		content,
		sentAt: Date.now(),
		read: false,
	};

	// Add to target's inbox
	if (targetInbox) {
		addInboxItem(targetInbox.instanceId, itemBase);
	}

	// Add to sender's outbox
	if (senderInbox) {
		addOutboxItem(senderInbox.instanceId, itemBase);
	}

	autoSave();
	return targetInbox?.instanceId ?? senderInbox?.instanceId ?? null;
}

/**
 * Get all unread inbox items for a specific agent.
 */
export function getUnreadInboxItems(agentId: string): InboxItem[] {
	const inboxEl = Object.values(workshopState.elements).find(
		(el) => el.type === 'inbox' && el.inboxAgentId === agentId,
	);
	if (!inboxEl || !inboxEl.inboxItems) return [];
	return inboxEl.inboxItems.filter((m) => !m.read);
}
