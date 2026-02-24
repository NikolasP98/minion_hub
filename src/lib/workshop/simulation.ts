// src/lib/workshop/simulation.ts

import * as physics from './physics';
import * as sprites from './agent-sprite';
import * as ropeRenderer from './rope-renderer';
import { workshopState, updateAgentPosition, markAllInboxItemsRead } from '$lib/state/workshop.svelte';
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
