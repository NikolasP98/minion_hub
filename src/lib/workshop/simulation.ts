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

const WANDER_INTERVAL = 2000; // ms
const WANDER_RADIUS = 80;

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

// ---------------------------------------------------------------------------
// Internal tick
// ---------------------------------------------------------------------------

function tick(now: number): void {
	if (!running) return;

	const dt = now - lastTime;
	lastTime = now;
	elapsed += dt;
	wanderTimer += dt;

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

	// --- Schedule next frame ---
	animFrameId = requestAnimationFrame(tick);
}
