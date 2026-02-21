/**
 * Gateway Bridge for Workshop Conversations
 *
 * Bridges the workshop conversation manager to the existing WebSocket gateway.
 * The gateway protocol operates on single-agent sessions (agent:{id}:main), so
 * multi-agent conversations are orchestrated here by routing messages between
 * individual agent sessions in a turn-based loop.
 *
 * Architecture:
 *   1. Each agent keeps its own gateway session (agent:{agentId}:{workshopSessionSuffix})
 *   2. The bridge sends a prompt to Agent A, waits for the final response,
 *      then forwards the response (with context) to Agent B, and so on.
 *   3. Callbacks notify the UI of each message so speech bubbles / chat panels update.
 *
 * Limitations / future work:
 *   - The gateway has no native multi-agent conversation primitive. If one is
 *     added later, the bridge can be updated to use it instead of the
 *     orchestration loop.
 *   - Streaming (delta) is not forwarded to callbacks yet; only final messages.
 *   - Workshop sessions use a dedicated session suffix ("workshop:{convId}") so
 *     they don't collide with the user's main chat sessions.
 */

import { sendRequest } from '$lib/services/gateway.svelte';
import { conn } from '$lib/state/connection.svelte';
import { workshopState } from '$lib/state/workshop.svelte';
import { gw } from '$lib/state/gateway-data.svelte';
import { startConversation, endConversation } from './conversation-manager';
import { appendMessage } from '$lib/state/workshop-conversations.svelte';
import { configState } from '$lib/state/config.svelte';
import { uuid } from '$lib/utils/uuid';
import { extractText } from '$lib/utils/text';

// ---------------------------------------------------------------------------
// Deterministic session key builders
// ---------------------------------------------------------------------------

/**
 * Build a deterministic conversation key from sorted participant agent IDs.
 * Same pair of agents always gets the same key, so conversation history
 * accumulates across sessions on the gateway.
 */
function buildConversationKey(participantAgentIds: string[]): string {
	const sorted = [...participantAgentIds].sort().join(':');
	return `workshop:conv:${sorted}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkshopMessage {
	conversationId: string;
	agentId: string;
	instanceId: string;
	message: string;
	timestamp: number;
}

export interface WorkshopConversationHandle {
	conversationId: string;
	/** Abort the conversation early. */
	abort: () => void;
}

type MessageCallback = (msg: WorkshopMessage) => void;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Registered listeners for incoming workshop messages. */
const messageCallbacks: Set<MessageCallback> = new Set();

/** Active orchestration loops, keyed by conversationId. */
const activeLoops = new Map<
	string,
	{ aborted: boolean; turnCount: number; maxTurns: number }
>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a callback that fires whenever an agent produces a message in a
 * workshop conversation.
 *
 * Returns an unsubscribe function.
 */
export function onWorkshopMessage(callback: MessageCallback): () => void {
	messageCallbacks.add(callback);
	return () => {
		messageCallbacks.delete(callback);
	};
}

/**
 * Start a multi-agent workshop conversation.
 *
 * @param participantInstanceIds - Instance IDs of agents on the canvas.
 * @param taskPrompt - The initial prompt / task description.
 * @param maxTurns - Maximum number of back-and-forth turns (default 6).
 * @returns A handle with the conversation ID and an abort function, or null
 *          if the conversation could not be started (e.g. not connected).
 */
export function startWorkshopConversation(
	participantInstanceIds: string[],
	taskPrompt: string,
	maxTurns = 6,
): WorkshopConversationHandle | null {
	if (!conn.connected) {
		console.warn('[workshop-bridge] Cannot start conversation: not connected to gateway');
		return null;
	}

	if (participantInstanceIds.length < 2) {
		console.warn('[workshop-bridge] Need at least 2 participants');
		return null;
	}

	// Resolve instance IDs to agent IDs
	const participants = participantInstanceIds.map((iid) => {
		const inst = workshopState.agents[iid];
		return { instanceId: iid, agentId: inst?.agentId ?? '' };
	});

	if (participants.some((p) => !p.agentId)) {
		console.warn('[workshop-bridge] Some participant instance IDs could not be resolved');
		return null;
	}

	const agentIds = participants.map((p) => p.agentId);

	// Create a deterministic session key for this conversation
	const convSessionKey = buildConversationKey(agentIds);

	// Build a human-readable title from agent names
	const nameOf = (agentId: string): string => {
		const gwAgent = gw.agents.find((a: { id: string }) => a.id === agentId);
		return gwAgent?.name ?? agentId;
	};
	const title = agentIds.map(nameOf).join(' & ');

	// Register with the conversation manager
	const conversationId = startConversation('task', participantInstanceIds, agentIds, convSessionKey, title);
	if (!conversationId) {
		console.warn('[workshop-bridge] Conversation manager rejected the conversation');
		return null;
	}

	const loopState = { aborted: false, turnCount: 0, maxTurns };
	activeLoops.set(conversationId, loopState);

	// Kick off the orchestration loop asynchronously
	runOrchestrationLoop(conversationId, participants, taskPrompt, loopState).catch((err) => {
		console.error('[workshop-bridge] Orchestration loop error:', err);
		endConversation(conversationId);
		activeLoops.delete(conversationId);
	});

	return {
		conversationId,
		abort: () => {
			loopState.aborted = true;
			endConversation(conversationId);
			activeLoops.delete(conversationId);
		},
	};
}

/**
 * Send a one-off message from a specific agent in the context of a workshop
 * conversation. This is used for the "Assign task" flow where only one agent
 * is involved.
 *
 * @returns The agent's response text, or null on failure.
 */
export async function sendAgentMessage(
	conversationId: string,
	fromInstanceId: string,
	message: string,
): Promise<string | null> {
	const inst = workshopState.agents[fromInstanceId];
	if (!inst) return null;

	const agentId = inst.agentId;
	const sessionKey = buildWorkshopSessionKey(agentId, conversationId);

	try {
		const responseText = await sendAndWaitForResponse(agentId, sessionKey, message);

		if (responseText) {
			emitMessage({
				conversationId,
				agentId,
				instanceId: fromInstanceId,
				message: responseText,
				timestamp: Date.now(),
			});
		}

		return responseText;
	} catch (err) {
		console.error('[workshop-bridge] sendAgentMessage error:', err);
		return null;
	}
}

/**
 * Start a single-agent task conversation (for the "Assign task" action).
 */
export function assignTask(
	instanceId: string,
	taskPrompt: string,
): WorkshopConversationHandle | null {
	if (!conn.connected) {
		console.warn('[workshop-bridge] Cannot assign task: not connected to gateway');
		return null;
	}

	const inst = workshopState.agents[instanceId];
	if (!inst) return null;

	const convSessionKey = `workshop:task:${inst.agentId}`;
	const conversationId = startConversation('task', [instanceId], [inst.agentId], convSessionKey);
	if (!conversationId) return null;

	const loopState = { aborted: false, turnCount: 0, maxTurns: 1 };
	activeLoops.set(conversationId, loopState);

	// Send the task and handle the response
	(async () => {
		try {
			const agentId = inst.agentId;
			const sessionKey = buildWorkshopSessionKey(agentId, conversationId);

			const responseText = await sendAndWaitForResponse(agentId, sessionKey, taskPrompt);
			if (responseText && !loopState.aborted) {
				emitMessage({
					conversationId,
					agentId,
					instanceId,
					message: responseText,
					timestamp: Date.now(),
				});
			}
		} catch (err) {
			console.error('[workshop-bridge] assignTask error:', err);
		} finally {
			endConversation(conversationId);
			activeLoops.delete(conversationId);
		}
	})();

	return {
		conversationId,
		abort: () => {
			loopState.aborted = true;
			endConversation(conversationId);
			activeLoops.delete(conversationId);
		},
	};
}

/**
 * Check whether a conversation loop is still running.
 */
export function isConversationActive(conversationId: string): boolean {
	return activeLoops.has(conversationId);
}

// ---------------------------------------------------------------------------
// Orchestration loop
// ---------------------------------------------------------------------------

async function runOrchestrationLoop(
	conversationId: string,
	participants: Array<{ instanceId: string; agentId: string }>,
	taskPrompt: string,
	loopState: { aborted: boolean; turnCount: number; maxTurns: number },
): Promise<void> {
	// Build agent name map for context formatting
	const nameOf = (agentId: string): string => {
		const gwAgent = gw.agents.find((a: { id: string }) => a.id === agentId);
		return gwAgent?.name ?? agentId;
	};

	// The first participant gets the original task prompt
	let currentTurnIdx = 0;
	let previousResponse = '';
	let previousAgentName = '';
	const collectedMessages: string[] = [];

	// Initial prompt to first agent
	const firstParticipant = participants[0];
	const otherNames = participants
		.slice(1)
		.map((p) => nameOf(p.agentId))
		.join(', ');

	const initialPrompt = formatInitialPrompt(taskPrompt, otherNames, participants.length);

	try {
		const sessionKey = buildWorkshopSessionKey(firstParticipant.agentId, conversationId);
		const response = await sendAndWaitForResponse(
			firstParticipant.agentId,
			sessionKey,
			initialPrompt,
		);

		if (loopState.aborted || !response) return;

		previousResponse = response;
		previousAgentName = nameOf(firstParticipant.agentId);
		loopState.turnCount++;
		collectedMessages.push(`${previousAgentName}: ${response}`);

		emitMessage({
			conversationId,
			agentId: firstParticipant.agentId,
			instanceId: firstParticipant.instanceId,
			message: response,
			timestamp: Date.now(),
		});

		// Continue the loop: alternate between participants
		while (loopState.turnCount < loopState.maxTurns && !loopState.aborted) {
			currentTurnIdx = (currentTurnIdx + 1) % participants.length;
			const participant = participants[currentTurnIdx];
			const agentSessionKey = buildWorkshopSessionKey(participant.agentId, conversationId);

			const turnPrompt = formatTurnPrompt(
				taskPrompt,
				previousAgentName,
				previousResponse,
				loopState.turnCount,
				loopState.maxTurns,
			);

			const turnResponse = await sendAndWaitForResponse(
				participant.agentId,
				agentSessionKey,
				turnPrompt,
			);

			if (loopState.aborted || !turnResponse) break;

			previousResponse = turnResponse;
			previousAgentName = nameOf(participant.agentId);
			loopState.turnCount++;
			collectedMessages.push(`${previousAgentName}: ${turnResponse}`);

			emitMessage({
				conversationId,
				agentId: participant.agentId,
				instanceId: participant.instanceId,
				message: turnResponse,
				timestamp: Date.now(),
			});
		}
	} finally {
		if (!loopState.aborted) {
			endConversation(conversationId);

			// Best-effort owner notification for personal agents
			const recentMessages = collectedMessages.slice(-4);
			tryOwnerNotification(participants, conversationId, recentMessages).catch(() => {});
		}
		activeLoops.delete(conversationId);
	}
}

// ---------------------------------------------------------------------------
// Gateway communication
// ---------------------------------------------------------------------------

/**
 * Build a workshop-specific session key that won't collide with the user's
 * main chat session for the same agent.
 */
function buildWorkshopSessionKey(agentId: string, conversationId: string): string {
	return `agent:${agentId}:workshop:${conversationId}`;
}

/**
 * Send a chat message to a specific agent session and wait for the final
 * response. This uses the same `chat.send` method as the main UI, but on a
 * workshop-specific session key.
 *
 * Returns the extracted text of the assistant's response, or null.
 */
async function sendAndWaitForResponse(
	agentId: string,
	sessionKey: string,
	message: string,
	timeoutMs = 120_000,
): Promise<string | null> {
	const runId = uuid();

	try {
		await sendRequest(
			'chat.send',
			{ sessionKey, message, deliver: false, idempotencyKey: runId },
			15_000,
		);
	} catch (err) {
		console.error('[workshop-bridge] chat.send failed:', err);
		return null;
	}

	// Poll for the response by loading chat history after a delay.
	// The gateway streams chat events, but those are handled by the global
	// onChatEvent handler in gateway.svelte.ts which updates agentChat state.
	// For workshop sessions with custom session keys, those events won't be
	// captured by the default handler (it parses agent:{id}:main pattern).
	//
	// Instead, we poll chat.history on our workshop session key.
	return new Promise<string | null>((resolve) => {
		const startTime = Date.now();
		let resolved = false;

		const poll = async () => {
			if (resolved) return;
			if (Date.now() - startTime > timeoutMs) {
				resolved = true;
				resolve(null);
				return;
			}

			try {
				const res = (await sendRequest('chat.history', {
					sessionKey,
					limit: 10,
				})) as { messages?: Array<{ role: string; content: unknown }> } | null;

				const messages = res?.messages ?? [];
				// Find the last assistant message
				for (let i = messages.length - 1; i >= 0; i--) {
					const msg = messages[i];
					if (msg.role === 'assistant') {
						const text = extractText(msg);
						if (typeof text === 'string' && text.trim()) {
							resolved = true;
							resolve(text);
							return;
						}
					}
				}
			} catch {
				// Ignore polling errors, retry
			}

			// Poll again after a delay
			if (!resolved) {
				setTimeout(poll, 2000);
			}
		};

		// Give the agent a moment to start processing before first poll
		setTimeout(poll, 3000);
	});
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

function formatInitialPrompt(
	taskPrompt: string,
	otherAgentNames: string,
	totalParticipants: number,
): string {
	if (totalParticipants <= 1) {
		return taskPrompt;
	}

	return [
		`You are participating in a workshop conversation with ${otherAgentNames}.`,
		``,
		`Task: ${taskPrompt}`,
		``,
		`Please share your initial thoughts and approach. Your response will be shared with the other participant(s) for discussion.`,
		`Keep your response focused and concise.`,
	].join('\n');
}

function formatTurnPrompt(
	taskPrompt: string,
	previousAgentName: string,
	previousResponse: string,
	turnNumber: number,
	maxTurns: number,
): string {
	const remaining = maxTurns - turnNumber;
	const isLastTurn = remaining <= 1;

	const lines = [
		`You are participating in a workshop conversation.`,
		``,
		`Original task: ${taskPrompt}`,
		``,
		`${previousAgentName} said:`,
		`> ${previousResponse.split('\n').join('\n> ')}`,
		``,
	];

	if (isLastTurn) {
		lines.push(
			`This is the final turn. Please summarize any conclusions or action items.`,
		);
	} else {
		lines.push(
			`Please respond with your thoughts. ${remaining} turns remaining in this conversation.`,
		);
	}

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emitMessage(msg: WorkshopMessage): void {
	// Persist message in the conversation state cache
	const conv = Object.values(workshopState.conversations).find(
		(c) => c.id === msg.conversationId,
	);
	if (conv) {
		appendMessage(conv.sessionKey, {
			role: 'assistant',
			agentId: msg.agentId,
			instanceId: msg.instanceId,
			content: msg.message,
			timestamp: msg.timestamp,
		});
	}

	// Fire callbacks for speech bubbles / other listeners
	for (const cb of messageCallbacks) {
		try {
			cb(msg);
		} catch (err) {
			console.error('[workshop-bridge] Callback error:', err);
		}
	}
}

// ---------------------------------------------------------------------------
// Owner notification
// ---------------------------------------------------------------------------

/**
 * Check if an agent is "personal" (bound to a single channel, implying it
 * belongs to a specific user rather than being a shared/default agent).
 */
function isPersonalAgent(agentId: string): boolean {
	const bindings = configState.current?.bindings as
		| Array<{ agentId: string }>
		| undefined;
	if (!bindings || !Array.isArray(bindings)) return false;
	return bindings.filter((b) => b.agentId === agentId).length === 1;
}

/**
 * After a conversation ends, if any participant is a personal agent, prompt
 * them to notify their owner about the conversation (best-effort).
 */
async function tryOwnerNotification(
	participants: Array<{ instanceId: string; agentId: string }>,
	conversationId: string,
	lastMessages: string[],
): Promise<void> {
	for (const p of participants) {
		if (!isPersonalAgent(p.agentId)) continue;

		const sessionKey = buildWorkshopSessionKey(p.agentId, conversationId);
		const summary = lastMessages.slice(-4).join('\n---\n');

		const prompt = [
			'A workshop conversation you participated in just ended. Here is a brief summary of the recent exchange:',
			'',
			summary,
			'',
			'If anything in this conversation is relevant to your owner, please notify them using your available communication tools.',
			'Keep it brief and only notify if truly important. If nothing warrants notification, simply respond with "No notification needed."',
		].join('\n');

		try {
			await sendAndWaitForResponse(p.agentId, sessionKey, prompt, 60_000);
		} catch {
			// non-critical — best effort notification
		}
	}
}

// ---------------------------------------------------------------------------
// Conversation history loading
// ---------------------------------------------------------------------------

/**
 * Load combined conversation history from the gateway by fetching each
 * participant's session transcript and interleaving by timestamp.
 */
export async function loadConversationHistory(
	conv: import('$lib/state/workshop.svelte').WorkshopConversation,
): Promise<import('$lib/state/workshop-conversations.svelte').ConversationMessage[]> {
	const { setMessages, conversationLoading } = await import(
		'$lib/state/workshop-conversations.svelte'
	);

	conversationLoading[conv.sessionKey] = true;

	try {
		const allMessages: import('$lib/state/workshop-conversations.svelte').ConversationMessage[] =
			[];

		for (const agentId of conv.participantAgentIds) {
			const sessionKey = buildWorkshopSessionKey(agentId, conv.sessionKey);

			try {
				const res = (await sendRequest('chat.history', {
					sessionKey,
					limit: 200,
				})) as { messages?: Array<{ role: string; content: unknown; timestamp?: number }> } | null;

				const messages = res?.messages ?? [];
				for (const msg of messages) {
					const text = extractText(msg);
					if (typeof text === 'string' && text.trim()) {
						allMessages.push({
							role: msg.role as 'user' | 'assistant',
							agentId,
							content: text,
							timestamp: msg.timestamp ?? 0,
						});
					}
				}
			} catch {
				// Skip this agent's history on error
			}
		}

		// Sort by timestamp to interleave messages from different agents
		allMessages.sort((a, b) => a.timestamp - b.timestamp);
		setMessages(conv.sessionKey, allMessages);
		return allMessages;
	} finally {
		conversationLoading[conv.sessionKey] = false;
	}
}
