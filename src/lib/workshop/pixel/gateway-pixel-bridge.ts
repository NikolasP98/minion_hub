/**
 * Gateway ↔ Pixel Office Bridge
 *
 * Maps workshop agent state (from gateway WebSocket data) to pixel office
 * character state. Updates character isActive, currentTool, and bubbles
 * based on the workshop FSM state and gateway presence.
 *
 * This module is the key integration point — it makes pixel characters
 * animate based on real agent activity.
 */

import type { OfficeState } from './office-state';
import type { AgentFsmState } from '../agent-fsm';
import { getAgentState } from '../agent-fsm';
import { workshopState } from '$lib/state/workshop/workshop.svelte';
import { CharacterState, TILE_SIZE } from './types';
import { WALK_SPEED_RETURN_PX_PER_SEC, PALETTE_COUNT } from './constants';

/** Map from workshop instanceId (string) → pixel character id (number) */
const instanceToCharId = new Map<string, number>();
const charIdToInstance = new Map<number, string>();
let nextCharId = 1;

export function getCharIdForInstance(instanceId: string): number | undefined {
	return instanceToCharId.get(instanceId);
}

export function getInstanceForCharId(charId: number): string | undefined {
	return charIdToInstance.get(charId);
}

export function registerMapping(instanceId: string, charId: number): void {
	instanceToCharId.set(instanceId, charId);
	charIdToInstance.set(charId, instanceId);
}

export function clearMappings(): void {
	instanceToCharId.clear();
	charIdToInstance.clear();
	nextCharId = 1;
}

export function allocateCharId(): number {
	return nextCharId++;
}

/**
 * Map workshop agent FSM state to pixel character isActive flag.
 * Active = agent is doing something (typing, reading, conversing)
 * Inactive = agent is idle, waiting, cooldown
 */
function fsmStateToActive(state: AgentFsmState | null): boolean {
	switch (state) {
		case 'conversing':
		case 'reading':
			return true;
		case 'idle':
		case 'wandering':
		case 'patrolling':
		case 'cooldown':
		case 'heartbeat':
		case 'dragged':
		default:
			return false;
	}
}

/**
 * Map workshop agent FSM state to a tool name hint for the pixel renderer.
 * This determines whether the character shows typing or reading animation.
 * Only used as a fallback when no real tool-call event is active (D-10).
 */
function fsmStateToTool(state: AgentFsmState | null): string | null {
	switch (state) {
		case 'conversing':
			return 'Write'; // typing animation
		case 'reading':
			return 'Read'; // reading animation
		default:
			return null;
	}
}

/**
 * Generate a deterministic palette index from an agent ID string (D-05).
 * Uses djb2-style hash so the same agentId always maps to the same palette.
 */
export function paletteFromAgentId(agentId: string, paletteCount: number): number {
	let hash = 0;
	for (let i = 0; i < agentId.length; i++) {
		hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
	}
	return Math.abs(hash) % paletteCount;
}

/**
 * Set the current tool for a character by instanceId.
 * Called by the tool-call event listener (Task 3) with real tool names.
 */
export function setAgentTool(office: OfficeState, instanceId: string, toolId: string | null): void {
	const charId = instanceToCharId.get(instanceId);
	if (charId === undefined) return;
	const ch = office.characters.get(charId);
	if (!ch) return;
	ch.currentTool = toolId;
}

/**
 * Sync workshop agent state to pixel office characters.
 * Call this every frame or on state changes.
 *
 * Uses office.setAgentActive() to properly trigger furniture rebuild (GATE-04).
 * Only calls setAgentActive when state changes to avoid every-frame rebuilds (Pitfall 2).
 * FSM tool hint is only applied when currentTool is null, to avoid racing with
 * real tool-call events from startToolCallListener (D-10).
 */
export function syncAgentState(office: OfficeState): void {
	for (const [instanceId, charId] of instanceToCharId) {
		const ch = office.characters.get(charId);
		if (!ch) continue;

		const fsmState = getAgentState(instanceId);
		const shouldBeActive = fsmStateToActive(fsmState);

		// Only call setAgentActive when state actually changes (Pitfall 2: avoids
		// rebuildFurnitureInstances every frame)
		if (ch.isActive !== shouldBeActive) {
			// D-03: If agent becomes active while not already seated/typing, set return speed
			if (shouldBeActive && ch.state !== CharacterState.TYPE) {
				ch.walkSpeedOverride = WALK_SPEED_RETURN_PX_PER_SEC; // 128px/sec
			}
			// GATE-04: triggers rebuildFurnitureInstances for CRT ON
			office.setAgentActive(charId, shouldBeActive);
		}

		// GATE-06: Show waiting bubble on cooldown transition
		if (fsmState === 'cooldown') {
			if (ch.bubbleType !== 'waiting' && ch.bubbleType !== 'permission') {
				office.showWaitingBubble(charId);
			}
		}

		// D-10: FSM tool fallback — only set when no real tool-call event has set currentTool.
		// Tool-call events (from startToolCallListener) fire asynchronously between frames;
		// syncAgentState runs each frame and should only set tool when ch.currentTool is null.
		if (!ch.currentTool) {
			const fsmTool = fsmStateToTool(fsmState);
			ch.currentTool = fsmTool;
		}
	}
}

/**
 * Add/remove characters to match the current workshop agent list.
 * Called when agents connect/disconnect from the gateway.
 *
 * @param office - The pixel office state to sync
 * @param isInitialLoad - When true, agents appear directly at seats without
 *   entrance spawn effects (D-17). When false (runtime connect), agents spawn
 *   at the entrance tile with matrix effect then walk to their seat (D-14).
 */
export function syncAgentList(office: OfficeState, isInitialLoad = false): void {
	const currentInstances = new Set(Object.keys(workshopState.agents));

	// Early exit if no changes
	if (currentInstances.size === instanceToCharId.size) {
		let allMatch = true;
		for (const id of currentInstances) {
			if (!instanceToCharId.has(id)) {
				allMatch = false;
				break;
			}
		}
		if (allMatch) return;
	}

	// Add new agents
	for (const instanceId of currentInstances) {
		if (instanceToCharId.has(instanceId)) continue;
		const charId = allocateCharId();
		registerMapping(instanceId, charId);

		// D-05: Deterministic palette from agentId
		const agentInstance = workshopState.agents[instanceId];
		const agentId = agentInstance?.agentId ?? instanceId;
		const palette = paletteFromAgentId(agentId, PALETTE_COUNT);

		if (isInitialLoad) {
			// D-17: Initial load — appear directly at seat, no entrance walk, no matrix effect
			office.addAgent(charId, palette, undefined, undefined, true);
		} else {
			// D-14: Runtime connect — spawn at entrance tile, matrix effect, then walk to seat
			office.addAgent(charId, palette);
			const entrance = office.findEntranceTile();
			if (entrance) {
				const ch = office.characters.get(charId);
				if (ch) {
					// Place at entrance tile; FSM will walk them to their seat
					ch.tileCol = entrance.col;
					ch.tileRow = entrance.row;
					ch.x = entrance.col * TILE_SIZE + TILE_SIZE / 2;
					ch.y = entrance.row * TILE_SIZE + TILE_SIZE / 2;
				}
			}
		}
	}

	// Remove departed agents (D-15: despawn effect at current position)
	for (const [instanceId, charId] of instanceToCharId) {
		if (currentInstances.has(instanceId)) continue;
		office.removeAgent(charId); // triggers matrix despawn effect
		instanceToCharId.delete(instanceId);
		charIdToInstance.delete(charId);
	}
}

/**
 * Start listening for pi-agent.tool-call window events to update
 * character tool names in real-time (D-10, GATE-03, GATE-05).
 * Returns cleanup function to call on teardown (Pitfall 5).
 */
export function startToolCallListener(office: OfficeState): () => void {
	function onToolCall(e: Event) {
		const payload = (e as CustomEvent).detail;
		if (!payload) return;

		const toolId: string = payload.toolId ?? payload.tool ?? '';
		const done: boolean = payload.done ?? false;
		const permissionWait: boolean = payload.permissionWait ?? false;

		// Resolve agentId -> instanceId -> charId
		// payload may have agentId or instanceId
		const agentId: string | undefined = payload.agentId;
		const payloadInstanceId: string | undefined = payload.instanceId;

		const matchedInstanceIds: string[] = [];
		if (payloadInstanceId && instanceToCharId.has(payloadInstanceId)) {
			matchedInstanceIds.push(payloadInstanceId);
		} else if (agentId) {
			// Find all workshop instances for this agentId
			for (const [instId, agentInst] of Object.entries(workshopState.agents)) {
				if (agentInst.agentId === agentId && instanceToCharId.has(instId)) {
					matchedInstanceIds.push(instId);
				}
			}
		}

		for (const instanceId of matchedInstanceIds) {
			const charId = instanceToCharId.get(instanceId);
			if (charId === undefined) continue;

			// GATE-03: Update tool name for typing vs reading animation
			setAgentTool(office, instanceId, done ? null : toolId);

			// GATE-05: Permission bubble
			if (permissionWait && !done) {
				office.showPermissionBubble(charId);
			} else if (done) {
				office.clearPermissionBubble(charId);
			}
		}
	}

	window.addEventListener('pi-agent.tool-call', onToolCall);
	return () => window.removeEventListener('pi-agent.tool-call', onToolCall);
}

/**
 * Start listening for sub-agent spawn/complete events (D-09).
 * Returns cleanup function to call on teardown (Pitfall 5).
 */
export function startSubagentListener(office: OfficeState): () => void {
	function onSubagentSpawned(e: Event) {
		const payload = (e as CustomEvent).detail;
		if (!payload) return;
		const parentAgentId = payload.parentAgentId ?? payload.agentId;
		const toolId: string = payload.toolId ?? 'Task';

		// Resolve parentAgentId -> charId
		for (const [instId, agentInst] of Object.entries(workshopState.agents)) {
			if (agentInst.agentId === parentAgentId) {
				const parentCharId = instanceToCharId.get(instId);
				if (parentCharId !== undefined) {
					office.addSubagent(parentCharId, toolId);
					break;
				}
			}
		}
	}

	function onSubagentCompleted(e: Event) {
		const payload = (e as CustomEvent).detail;
		if (!payload) return;
		const parentAgentId = payload.parentAgentId ?? payload.agentId;
		const toolId: string = payload.toolId ?? 'Task';

		for (const [instId, agentInst] of Object.entries(workshopState.agents)) {
			if (agentInst.agentId === parentAgentId) {
				const parentCharId = instanceToCharId.get(instId);
				if (parentCharId !== undefined) {
					office.removeSubagent(parentCharId, toolId);
					break;
				}
			}
		}
	}

	window.addEventListener('pi-agent.subagent-spawned', onSubagentSpawned);
	window.addEventListener('pi-agent.subagent-completed', onSubagentCompleted);
	return () => {
		window.removeEventListener('pi-agent.subagent-spawned', onSubagentSpawned);
		window.removeEventListener('pi-agent.subagent-completed', onSubagentCompleted);
	};
}
