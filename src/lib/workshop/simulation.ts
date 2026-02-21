// src/lib/workshop/simulation.ts

import * as physics from './physics';
import * as sprites from './agent-sprite';
import * as ropeRenderer from './rope-renderer';
import { workshopState, updateAgentPosition } from '$lib/state/workshop.svelte';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let running = false;
let animFrameId: number | null = null;
let lastTime = 0;
let elapsed = 0;
let wanderTimer = 0;
let banterTimer = 0;

// Per-agent patrol phase angles (radians), advanced each tick
const patrolAngles = new Map<string, number>();

const WANDER_INTERVAL = 2000; // ms between wander impulses
const WANDER_RADIUS = 80; // px from homePosition

const PATROL_RADIUS = 90; // orbital radius for patrol
const PATROL_SPEED = 0.00055; // radians per ms  (~11s per full orbit)

const BANTER_INTERVAL = 28_000; // ms between idle-banter attempts

// Callback registered by WorkshopCanvas to start a banter conversation
let banterCallback: ((instanceIdA: string, instanceIdB: string) => void) | null = null;

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Start the simulation loop. Safe to call if already running (no-op).
 */
export function startSimulation(): void {
	if (running) return;
	running = true;
	lastTime = performance.now();
	animFrameId = requestAnimationFrame(tick);
}

/**
 * Stop the simulation loop and cancel the pending animation frame.
 */
export function stopSimulation(): void {
	running = false;
	if (animFrameId !== null) {
		cancelAnimationFrame(animFrameId);
		animFrameId = null;
	}
}

/**
 * Returns whether the simulation loop is currently running.
 */
export function isRunning(): boolean {
	return running;
}

/**
 * Register a callback that fires when the simulation detects a nearby idle pair
 * and wants to start a banter conversation. WorkshopCanvas wires this to the
 * gateway-bridge conversation starter.
 */
export function setBanterCallback(fn: ((a: string, b: string) => void) | null): void {
	banterCallback = fn;
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

	// --- Wander impulses ---
	if (wanderTimer >= WANDER_INTERVAL) {
		wanderTimer -= WANDER_INTERVAL;

		for (const agent of Object.values(workshopState.agents)) {
			if (agent.behavior === 'wander') {
				physics.applyWanderImpulse(
					agent.instanceId,
					agent.homePosition.x,
					agent.homePosition.y,
					WANDER_RADIUS
				);
			}
		}
	}

	// --- Patrol: smooth kinematic orbit around homePosition ---
	for (const agent of Object.values(workshopState.agents)) {
		if (agent.behavior !== 'patrol') continue;
		const angle = (patrolAngles.get(agent.instanceId) ?? Math.random() * Math.PI * 2) + dt * PATROL_SPEED;
		patrolAngles.set(agent.instanceId, angle);
		const x = agent.homePosition.x + Math.cos(angle) * PATROL_RADIUS;
		const y = agent.homePosition.y + Math.sin(angle) * PATROL_RADIUS;
		physics.setAgentPosition(agent.instanceId, x, y);
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
	// Build a set of instance IDs currently in an active conversation
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

		// A rope glows if both endpoints are in an active conversation together
		const isActive =
			activeParticipants.has(rel.fromInstanceId) &&
			activeParticipants.has(rel.toInstanceId);

		ropeRenderer.updateRope(
			relId,
			fromPos.x,
			fromPos.y,
			toPos.x,
			toPos.y,
			rel.label,
			isActive
		);
	}

	// --- Bobbing animation ---
	sprites.applyBobbingAnimation(elapsed);

	// --- Idle banter ---
	if (banterTimer >= BANTER_INTERVAL) {
		banterTimer -= BANTER_INTERVAL;
		tryIdleBanter(activeParticipants);
	}

	// --- Schedule next frame ---
	animFrameId = requestAnimationFrame(tick);
}

/**
 * Look for a nearby pair of idle agents and fire the banter callback for one
 * pair at most. Skips agents already in a conversation.
 */
function tryIdleBanter(activeParticipants: Set<string>): void {
	if (!banterCallback) return;
	if (!workshopState.settings.idleBanterEnabled) return;

	const activeCount = Object.values(workshopState.conversations).filter(
		(c) => c.status === 'active'
	).length;
	if (activeCount >= workshopState.settings.maxConcurrentConversations) return;

	const r = workshopState.settings.proximityRadius;
	const idle = Object.values(workshopState.agents).filter(
		(a) => !activeParticipants.has(a.instanceId)
	);

	for (let i = 0; i < idle.length; i++) {
		for (let j = i + 1; j < idle.length; j++) {
			const a = idle[i];
			const b = idle[j];
			const dx = a.position.x - b.position.x;
			const dy = a.position.y - b.position.y;
			if (Math.sqrt(dx * dx + dy * dy) <= r) {
				banterCallback(a.instanceId, b.instanceId);
				return; // one banter pair per cycle
			}
		}
	}
}
