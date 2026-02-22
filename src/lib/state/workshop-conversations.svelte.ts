/**
 * Workshop Conversation Messages State
 *
 * Holds in-memory message caches for workshop conversations, keyed by
 * conversation session key. Kept separate from workshop.svelte.ts because
 * messages are large and should not be autosaved to localStorage.
 */

export interface ConversationMessage {
	role: 'user' | 'assistant';
	agentId?: string;
	instanceId?: string;
	content: string;
	timestamp: number;
}

/** Message cache: conversationSessionKey → messages */
export const conversationMessages: Record<string, ConversationMessage[]> = $state({});

/** Loading state per conversation session key */
export const conversationLoading: Record<string, boolean> = $state({});

export function appendMessage(sessionKey: string, msg: ConversationMessage): void {
	if (!conversationMessages[sessionKey]) {
		conversationMessages[sessionKey] = [];
	}
	// Dedup safety net: skip if the last message has the same agentId + content
	const msgs = conversationMessages[sessionKey];
	if (msgs.length > 0) {
		const last = msgs[msgs.length - 1];
		if (last.agentId === msg.agentId && last.content === msg.content) {
			return;
		}
	}
	conversationMessages[sessionKey] = [...msgs, msg];
}

export function setMessages(sessionKey: string, msgs: ConversationMessage[]): void {
	conversationMessages[sessionKey] = msgs;
}

export function clearMessages(sessionKey: string): void {
	delete conversationMessages[sessionKey];
}

export function clearAllMessages(): void {
	for (const key of Object.keys(conversationMessages)) {
		delete conversationMessages[key];
	}
}

// ---------------------------------------------------------------------------
// Thinking/typing indicator state
// ---------------------------------------------------------------------------

/** Tracks which agent instances are currently generating a response */
export const thinkingAgents: Record<string, boolean> = $state({});

export function setAgentThinking(instanceId: string, thinking: boolean): void {
	if (thinking) {
		thinkingAgents[instanceId] = true;
	} else {
		delete thinkingAgents[instanceId];
	}
}
