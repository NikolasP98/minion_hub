// src/lib/workshop/simulation.ts

import * as physics from './physics';
import * as sprites from './agent-sprite';
import * as ropeRenderer from './rope-renderer';
import { workshopState, updateAgentPosition, markAllInboxItemsRead } from '$lib/state/workshop.svelte';
import { agentMemory } from '$lib/state/workshop.svelte';
import type { AgentInstance } from '$lib/state/workshop.svelte';
import {
	getAgentFsm,
	getAgentState,
	isAgentConversing,
	sendFsmEvent,
	setHeartbeatEnterCallback,
} from './agent-fsm';
import { findNearbyAgents, findNearbyElements } from './proximity';
import { showReactionEmoji } from './agent-sprite';
import { peek, dequeue, enqueue, clearAllQueues } from './agent-queue';
import {
	getSessionTurnCount,
	resetSessionTurnCount,
	compactAgentContext,
	readElementForAgent,
	buildWorkshopSessionKey_public,
} from './gateway-bridge';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let running = false;
let animFrameId: number | null = null;
let lastTime = 0;
let elapsed = 0;
let wanderTimer = 0;
let banterTimer = 0;

// Patrol: per-agent orbital angle (radians)
const patrolAngles = new Map<string, number>();

// Wander: per-agent current target position
const wanderTargets = new Map<string, { x: number; y: number }>();

// Heartbeat: ms remaining until next heartbeat per idle agent
const heartbeatTimers = new Map<string, number>();

// Element reaction cooldowns: `${agentId}:${elementId}` → ms remaining
const elementReactionCooldowns = new Map<string, number>();

// Walk-to-read: agents en route to an element before reading it
const walkToReadQueue = new Map<string, {
	elementId: string;
	sessionKey: string;
	position: { x: number; y: number };
}>();

// Seek-info timers: ms until next periodic element re-read per agent
const seekInfoTimers = new Map<string, number>();
const SEEK_INFO_INTERVAL = 90_000; // ms
const SEEK_INFO_RADIUS  = 400;     // px
const ELEMENT_STALE_MS  = 5 * 60_000; // 5 min

// Compaction thresholds
const COMPACT_TURN_THRESHOLD  = 8;
const COMPACT_TOKEN_THRESHOLD = 6000; // reserved for future token-count-based compaction trigger

const WANDER_INTERVAL = 3000; // ms between picking a new wander target
const WANDER_RADIUS = 120; // px from homePosition
const WANDER_SPEED = 80; // px per second toward target

const PATROL_RADIUS = 100; // orbital radius
const PATROL_SPEED = 0.0006; // radians per ms (~10.5s per full orbit)

const HEARTBEAT_MIN = 10_000; // ms
const HEARTBEAT_MAX = 15_000; // ms
const HEARTBEAT_SCAN_RADIUS = 280; // px

const INTERACTION_RADIUS = 70; // px — element proximity reaction range
const WANDER_BIAS_RADIUS = 300; // px — range for biased wander targeting
const ELEMENT_COOLDOWN_MS = 30_000; // ms between element reactions per agent/element pair

// Banter interval is now read from workshopState.settings.banterCheckInterval

// Callback registered by WorkshopCanvas to start a banter conversation
let banterCallback: ((instanceIdA: string, instanceIdB: string) => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomBetween(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

/**
 * Find the closest interesting object (agent or element) within biasRadius
 * and return a target position near it, or null if nothing is nearby.
 */
function findBiasedWanderTarget(agent: AgentInstance): { x: number; y: number } | null {
	let closestDist = Infinity;
	let targetPos: { x: number; y: number } | null = null;

	// Check nearby agents
	for (const [id, other] of Object.entries(workshopState.agents)) {
		if (id === agent.instanceId) continue;
		const dx = other.position.x - agent.position.x;
		const dy = other.position.y - agent.position.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist <= WANDER_BIAS_RADIUS && dist < closestDist) {
			closestDist = dist;
			targetPos = other.position;
		}
	}

	// Check nearby elements
	const nearbyEls = findNearbyElements(agent.position, WANDER_BIAS_RADIUS);
	for (const { element, distance } of nearbyEls) {
		if (distance < closestDist) {
			closestDist = distance;
			targetPos = element.position;
		}
	}

	if (!targetPos) return null;

	return {
		x: targetPos.x + (Math.random() - 0.5) * 60,
		y: targetPos.y + (Math.random() - 0.5) * 60,
	};
}

/**
 * Awareness scan triggered when an agent enters heartbeat state.
 * If interesting objects are nearby, sets a wander target and transitions to wandering.
 */
function doHeartbeatAwarenessScan(instanceId: string): void {
	const agent = workshopState.agents[instanceId];
	if (!agent) return;

	let closestDist = Infinity;
	let targetPos: { x: number; y: number } | null = null;

	// Check nearby agents
	const nearbyAgentIds = findNearbyAgents(instanceId, HEARTBEAT_SCAN_RADIUS);
	for (const otherId of nearbyAgentIds) {
		const other = workshopState.agents[otherId];
		if (!other) continue;
		const dx = other.position.x - agent.position.x;
		const dy = other.position.y - agent.position.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < closestDist) {
			closestDist = dist;
			targetPos = other.position;
		}
	}

	// Check nearby elements
	const nearbyEls = findNearbyElements(agent.position, HEARTBEAT_SCAN_RADIUS);
	for (const { element, distance } of nearbyEls) {
		if (distance < closestDist) {
			closestDist = distance;
			targetPos = element.position;
		}
	}

	if (targetPos) {
		wanderTargets.set(instanceId, {
			x: targetPos.x + (Math.random() - 0.5) * 60,
			y: targetPos.y + (Math.random() - 0.5) * 60,
		});
		sendFsmEvent(instanceId, 'wander');
	}
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function startSimulation(): void {
	if (running) return;
	setHeartbeatEnterCallback(doHeartbeatAwarenessScan);
	running = true;
	lastTime = performance.now();
	animFrameId = requestAnimationFrame(tick);
}

export function stopSimulation(): void {
	running = false;
	setHeartbeatEnterCallback(null);
	if (animFrameId !== null) {
		cancelAnimationFrame(animFrameId);
		animFrameId = null;
	}
}

export function isRunning(): boolean {
	return running;
}

export function setBanterCallback(fn: ((a: string, b: string) => void) | null): void {
	banterCallback = fn;
}

/**
 * Remove all per-agent simulation state for an agent instance.
 * Call when an agent is removed from the canvas.
 */
export function removeAgentFromSimulation(instanceId: string): void {
	wanderTargets.delete(instanceId);
	patrolAngles.delete(instanceId);
	heartbeatTimers.delete(instanceId);
	seekInfoTimers.delete(instanceId);
	walkToReadQueue.delete(instanceId);
	for (const key of elementReactionCooldowns.keys()) {
		if (key.startsWith(`${instanceId}:`)) {
			elementReactionCooldowns.delete(key);
		}
	}
}

// ---------------------------------------------------------------------------
// Internal tick
// ---------------------------------------------------------------------------

function tick(now: number): void {
	if (!running) return;

	const dt = now - lastTime;
	lastTime = now;
	elapsed += dt;
	wanderTimer += dt;
	banterTimer += dt;

	// --- Heartbeat timers (idle agents only) ---
	for (const agent of Object.values(workshopState.agents)) {
		const id = agent.instanceId;
		const state = getAgentState(id);

		if (state !== 'idle') {
			// Any non-idle state resets the heartbeat timer
			heartbeatTimers.delete(id);
			continue;
		}

		// Initialize timer on first idle tick
		if (!heartbeatTimers.has(id)) {
			heartbeatTimers.set(id, randomBetween(HEARTBEAT_MIN, HEARTBEAT_MAX));
			continue;
		}

		const remaining = heartbeatTimers.get(id)! - dt;
		if (remaining <= 0) {
			heartbeatTimers.set(id, randomBetween(HEARTBEAT_MIN, HEARTBEAT_MAX));
			sendFsmEvent(id, 'heartbeatTrigger');
		} else {
			heartbeatTimers.set(id, remaining);
		}
	}

	// --- Seek-info timers ---
	for (const agent of Object.values(workshopState.agents)) {
		const id = agent.instanceId;
		const state = getAgentState(id);
		if (state === 'dragged' || state === 'conversing' || state === 'reading') continue;

		if (!seekInfoTimers.has(id)) {
			seekInfoTimers.set(id, SEEK_INFO_INTERVAL);
			continue;
		}

		const remaining = seekInfoTimers.get(id)! - dt;
		if (remaining <= 0) {
			seekInfoTimers.set(id, SEEK_INFO_INTERVAL);
			// Enqueue seekInfo for nearest stale element
			const nearbyEls = findNearbyElements(agent.position, SEEK_INFO_RADIUS);
			for (const { elementId } of nearbyEls) {
				const mem = agentMemory[id];
				const lastRead = mem?.environmentState[elementId]?.lastReadAt ?? 0;
				if (Date.now() - lastRead > ELEMENT_STALE_MS) {
					enqueue(id, { type: 'seekInfo', elementId });
					break;
				}
			}
		} else {
			seekInfoTimers.set(id, remaining);
		}
	}

	// --- Compaction check ---
	for (const agent of Object.values(workshopState.agents)) {
		const id = agent.instanceId;
		const state = getAgentState(id);
		if (state === 'dragged' || state === 'conversing' || state === 'reading') continue;

		// Find the most recent conversation session key for this agent
		const agentConvs = Object.values(workshopState.conversations)
			.filter((c) => c.participantInstanceIds.includes(id) && c.sessionKey);
		if (agentConvs.length === 0) continue;

		const latestConv = agentConvs.sort((a, b) => b.startedAt - a.startedAt)[0];
		const sessionKey = latestConv.sessionKey;

		const turns = getSessionTurnCount(buildWorkshopSessionKey_public(agent.agentId, sessionKey));
		if (turns >= COMPACT_TURN_THRESHOLD) {
			enqueue(id, { type: 'compactContext' });
		}
	}

	// --- Drain action queue for idle agents ---
	for (const agent of Object.values(workshopState.agents)) {
		const id = agent.instanceId;
		const state = getAgentState(id);

		// Only drain when agent is idle
		if (state !== 'idle') continue;

		const action = peek(id);
		if (!action) continue;

		const agentConvs = Object.values(workshopState.conversations)
			.filter((c) => c.participantInstanceIds.includes(id));
		const sessionKey = agentConvs.length > 0
			? agentConvs.sort((a, b) => b.startedAt - a.startedAt)[0].sessionKey
			: `solo:${agent.agentId}`;

		if (action.type === 'readElement' || action.type === 'seekInfo') {
			const elementId = action.elementId;
			dequeue(id);
			sendFsmEvent(id, 'startReading');
			// Run async, then stop reading when done
			readElementForAgent(id, elementId, sessionKey).then(() => {
				sendFsmEvent(id, 'stopReading');
			}).catch(() => {
				sendFsmEvent(id, 'stopReading');
			});
		} else if (action.type === 'compactContext') {
			dequeue(id);
			sendFsmEvent(id, 'startReading');
			const fullSessionKey = buildWorkshopSessionKey_public(agent.agentId, sessionKey);
			compactAgentContext(id, sessionKey).then(() => {
				resetSessionTurnCount(fullSessionKey);
				sendFsmEvent(id, 'stopReading');
			}).catch(() => {
				sendFsmEvent(id, 'stopReading');
			});
		} else if (action.type === 'approachAgent') {
			dequeue(id);
			// Set wander target toward the target agent
			const targetInst = workshopState.agents[action.targetInstanceId];
			if (targetInst) {
				wanderTargets.set(id, {
					x: targetInst.position.x + (Math.random() - 0.5) * 40,
					y: targetInst.position.y + (Math.random() - 0.5) * 40,
				});
				sendFsmEvent(id, 'wander');
			}
		}
	}

	// --- Drain action queue for wandering/patrolling agents (walk to element first) ---
	for (const agent of Object.values(workshopState.agents)) {
		const id = agent.instanceId;
		const state = getAgentState(id);

		if (state !== 'wandering' && state !== 'patrolling') continue;
		if (walkToReadQueue.has(id)) continue; // already en route

		const action = peek(id);
		if (!action) continue;

		const agentConvs = Object.values(workshopState.conversations)
			.filter((c) => c.participantInstanceIds.includes(id));
		const sessionKey = agentConvs.length > 0
			? agentConvs.sort((a, b) => b.startedAt - a.startedAt)[0].sessionKey
			: `solo:${agent.agentId}`;

		if (action.type === 'readElement' || action.type === 'seekInfo') {
			const element = workshopState.elements[action.elementId];
			if (element) {
				dequeue(id);
				walkToReadQueue.set(id, {
					elementId: action.elementId,
					sessionKey,
					position: element.position,
				});
				// Override wander target to walk toward element
				wanderTargets.set(id, {
					x: element.position.x + (Math.random() - 0.5) * 40,
					y: element.position.y + (Math.random() - 0.5) * 40,
				});
			}
		} else if (action.type === 'compactContext') {
			// compactContext executes in-place even while wandering/patrolling
			dequeue(id);
			sendFsmEvent(id, 'startReading');
			const fullSessionKey = buildWorkshopSessionKey_public(agent.agentId, sessionKey);
			compactAgentContext(id, sessionKey).then(() => {
				resetSessionTurnCount(fullSessionKey);
				sendFsmEvent(id, 'stopReading');
			}).catch(() => {
				sendFsmEvent(id, 'stopReading');
			});
		}
		// approachAgent: no change needed, already works while wandering
	}

	// --- Pick new wander targets every WANDER_INTERVAL (biased 60/40) ---
	if (wanderTimer >= WANDER_INTERVAL) {
		wanderTimer -= WANDER_INTERVAL;
		for (const agent of Object.values(workshopState.agents)) {
			const fsm = getAgentFsm(agent.instanceId);
			if (fsm ? fsm.current !== 'wandering' : agent.behavior !== 'wander') continue;

			let target: { x: number; y: number } | null = null;

			// 60% chance: pick target biased toward interesting nearby object
			if (Math.random() < 0.6) {
				target = findBiasedWanderTarget(agent);
			}

			// 40% (or fallback): random wander
			if (!target) {
				const angle = Math.random() * Math.PI * 2;
				const r = 30 + Math.random() * WANDER_RADIUS;
				target = {
					x: agent.homePosition.x + Math.cos(angle) * r,
					y: agent.homePosition.y + Math.sin(angle) * r,
				};
			}

			wanderTargets.set(agent.instanceId, target);
		}
	}

	// --- Move wander agents toward their targets (kinematic lerp) ---
	for (const agent of Object.values(workshopState.agents)) {
		const fsmW = getAgentFsm(agent.instanceId);
		if (fsmW ? fsmW.current !== 'wandering' : agent.behavior !== 'wander') continue;
		let target = wanderTargets.get(agent.instanceId);
		if (!target) {
			// Initialize a target on first tick
			const angle = Math.random() * Math.PI * 2;
			const r = 30 + Math.random() * WANDER_RADIUS;
			target = {
				x: agent.homePosition.x + Math.cos(angle) * r,
				y: agent.homePosition.y + Math.sin(angle) * r,
			};
			wanderTargets.set(agent.instanceId, target);
		}

		const dx = target.x - agent.position.x;
		const dy = target.y - agent.position.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < 3) continue;

		const step = Math.min(WANDER_SPEED * (dt / 1000), dist);
		physics.setAgentPosition(
			agent.instanceId,
			agent.position.x + (dx / dist) * step,
			agent.position.y + (dy / dist) * step,
		);

		// Check if arrived near walk-to-read target
		const walkTarget = walkToReadQueue.get(agent.instanceId);
		if (walkTarget) {
			const ex = walkTarget.position.x - agent.position.x;
			const ey = walkTarget.position.y - agent.position.y;
			if (Math.sqrt(ex * ex + ey * ey) < INTERACTION_RADIUS) {
				const wt = walkToReadQueue.get(agent.instanceId)!;
				walkToReadQueue.delete(agent.instanceId);
				// Verify element still exists
				if (workshopState.elements[wt.elementId]) {
					sendFsmEvent(agent.instanceId, 'startReading');
					readElementForAgent(agent.instanceId, wt.elementId, wt.sessionKey).then(() => {
						sendFsmEvent(agent.instanceId, 'stopReading');
					}).catch(() => {
						sendFsmEvent(agent.instanceId, 'stopReading');
					});
				}
			}
		}
	}

	// --- Patrol: smooth kinematic orbit around homePosition ---
	for (const agent of Object.values(workshopState.agents)) {
		const fsmP = getAgentFsm(agent.instanceId);
		if (fsmP ? fsmP.current !== 'patrolling' : agent.behavior !== 'patrol') continue;
		const angle = (patrolAngles.get(agent.instanceId) ?? Math.random() * Math.PI * 2) + dt * PATROL_SPEED;
		patrolAngles.set(agent.instanceId, angle);
		physics.setAgentPosition(
			agent.instanceId,
			agent.homePosition.x + Math.cos(angle) * PATROL_RADIUS,
			agent.homePosition.y + Math.sin(angle) * PATROL_RADIUS,
		);
	}

	// --- Physics step ---
	physics.step();

	// --- Sync positions from physics to sprites and state store ---
	const positions = physics.getAllPositions();
	for (const [instanceId, pos] of positions) {
		sprites.updateSpritePosition(instanceId, pos.x, pos.y);
		updateAgentPosition(instanceId, pos.x, pos.y);
	}

	// --- Update rope visuals ---
	const activeParticipants = new Set<string>();
	for (const convo of Object.values(workshopState.conversations)) {
		if (convo.status === 'active') {
			for (const pid of convo.participantInstanceIds) {
				activeParticipants.add(pid);
			}
		}
	}

	for (const [relId, rel] of Object.entries(workshopState.relationships)) {
		const fromPos = positions.get(rel.fromInstanceId);
		const toPos = positions.get(rel.toInstanceId);
		if (!fromPos || !toPos) continue;

		const isActive =
			activeParticipants.has(rel.fromInstanceId) &&
			activeParticipants.has(rel.toInstanceId);

		ropeRenderer.updateRope(relId, fromPos.x, fromPos.y, toPos.x, toPos.y, rel.label, isActive);
	}

	// --- Bobbing animation ---
	sprites.applyBobbingAnimation(elapsed);

	// --- Idle banter ---
	const banterInterval = workshopState.settings.banterCheckInterval;
	if (banterTimer >= banterInterval) {
		banterTimer -= banterInterval;
		tryIdleBanter(activeParticipants);
	}

	// --- Element reaction cooldowns tick ---
	for (const [key, remaining] of elementReactionCooldowns) {
		const next = remaining - dt;
		if (next <= 0) {
			elementReactionCooldowns.delete(key);
		} else {
			elementReactionCooldowns.set(key, next);
		}
	}

	// --- Element proximity reactions (moving agents) ---
	for (const agent of Object.values(workshopState.agents)) {
		const state = getAgentState(agent.instanceId);
		if (state !== 'wandering' && state !== 'patrolling' && state !== 'heartbeat') continue;

		const nearbyEls = findNearbyElements(agent.position, INTERACTION_RADIUS);
		for (const { elementId, element } of nearbyEls) {
			const cooldownKey = `${agent.instanceId}:${elementId}`;
			if (elementReactionCooldowns.has(cooldownKey)) continue;

			let emoji: string;
			if (element.type === 'inbox') {
				const hasUnread = element.inboxItems?.some((i) => !i.read);
				emoji = hasUnread ? '📬' : '📭';
				if (element.inboxAgentId === agent.agentId && hasUnread) {
					markAllInboxItemsRead(elementId);
				}
			} else if (element.type === 'pinboard') {
				emoji = '📌';
			} else {
				emoji = '📋';
			}

			showReactionEmoji(agent.instanceId, emoji);
			elementReactionCooldowns.set(cooldownKey, ELEMENT_COOLDOWN_MS);
		}
	}

	animFrameId = requestAnimationFrame(tick);
}

/**
 * Compute the spawn Y for a new agent so it appears above existing elements.
 * @param dropY — The Y from the drop event (world coordinates)
 */
export function computeSpawnY(dropY: number): number {
	const elementYs = Object.values(workshopState.elements).map((e) => e.position.y);
	if (elementYs.length === 0) return dropY;
	const minY = Math.min(...elementYs);
	return Math.min(dropY, minY - 120);
}

function tryIdleBanter(activeParticipants: Set<string>): void {
	if (!banterCallback) return;
	if (!workshopState.settings.idleBanterEnabled) return;

	const activeCount = Object.values(workshopState.conversations).filter(
		(c) => c.status === 'active'
	).length;
	if (activeCount >= workshopState.settings.maxConcurrentConversations) return;

	const r = workshopState.settings.proximityRadius;
	const idle = Object.values(workshopState.agents).filter(
		(a) => !isAgentConversing(a.instanceId) && !activeParticipants.has(a.instanceId)
	);

	for (let i = 0; i < idle.length; i++) {
		for (let j = i + 1; j < idle.length; j++) {
			const a = idle[i];
			const b = idle[j];
			const dx = a.position.x - b.position.x;
			const dy = a.position.y - b.position.y;
			if (Math.sqrt(dx * dx + dy * dy) <= r) {
				banterCallback(a.instanceId, b.instanceId);
				return;
			}
		}
	}
}
