// src/lib/workshop/simulation.ts

import * as physics from './physics';
import * as sprites from './agent-sprite';
import * as ropeRenderer from './rope-renderer';
import { workshopState, updateAgentPosition } from '$lib/state/workshop.svelte';
import { getAgentFsm, isAgentConversing } from './agent-fsm';

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

const WANDER_INTERVAL = 3000; // ms between picking a new wander target
const WANDER_RADIUS = 120; // px from homePosition
const WANDER_SPEED = 80; // px per second toward target

const PATROL_RADIUS = 100; // orbital radius
const PATROL_SPEED = 0.0006; // radians per ms (~10.5s per full orbit)

const BANTER_INTERVAL = 28_000; // ms between idle-banter attempts

// Callback registered by WorkshopCanvas to start a banter conversation
let banterCallback: ((instanceIdA: string, instanceIdB: string) => void) | null = null;

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function startSimulation(): void {
	if (running) return;
	running = true;
	lastTime = performance.now();
	animFrameId = requestAnimationFrame(tick);
}

export function stopSimulation(): void {
	running = false;
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

	// --- Pick new wander targets every WANDER_INTERVAL ---
	if (wanderTimer >= WANDER_INTERVAL) {
		wanderTimer -= WANDER_INTERVAL;
		for (const agent of Object.values(workshopState.agents)) {
			const fsm = getAgentFsm(agent.instanceId);
			if (fsm ? fsm.current !== 'wandering' : agent.behavior !== 'wander') continue;
			const angle = Math.random() * Math.PI * 2;
			const r = 30 + Math.random() * WANDER_RADIUS;
			wanderTargets.set(agent.instanceId, {
				x: agent.homePosition.x + Math.cos(angle) * r,
				y: agent.homePosition.y + Math.sin(angle) * r,
			});
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
	if (banterTimer >= BANTER_INTERVAL) {
		banterTimer -= BANTER_INTERVAL;
		tryIdleBanter(activeParticipants);
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
