import RAPIER from '@dimforge/rapier2d-compat';

let world: RAPIER.World | null = null;
let initialized = false;

const bodies = new Map<string, RAPIER.RigidBody>();
const colliders = new Map<string, RAPIER.Collider>();
const joints = new Map<string, RAPIER.ImpulseJoint>();

/**
 * Initialize Rapier and create a World with zero gravity.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export async function initPhysics(): Promise<void> {
	if (initialized) return;
	// Suppress internal rapier2d-compat warning: its init wrapper passes decoded
	// WASM bytes directly to __wbg_init which triggers its own deprecation warning.
	// This is a known issue in @dimforge/rapier2d-compat@0.19.x with no upstream fix.
	const origWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		if (typeof args[0] === 'string' && args[0].includes('deprecated parameters')) return;
		origWarn.apply(console, args);
	};
	try {
		await RAPIER.init();
	} finally {
		console.warn = origWarn;
	}
	world = new RAPIER.World({ x: 0.0, y: 0.0 });
	initialized = true;
}

function ensureWorld(): RAPIER.World {
	if (!world) throw new Error('Physics not initialized. Call initPhysics() first.');
	return world;
}

// ---------------------------------------------------------------------------
// Agent body operations
// ---------------------------------------------------------------------------

/**
 * Create a kinematic position-based rigid body with a ball collider (radius 30)
 * for the given agent instance.
 */
export function addAgentBody(instanceId: string, x: number, y: number): void {
	const w = ensureWorld();

	if (bodies.has(instanceId)) return;

	const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y);
	const body = w.createRigidBody(bodyDesc);

	const colliderDesc = RAPIER.ColliderDesc.ball(30).setRestitution(0.2);
	const collider = w.createCollider(colliderDesc, body);

	bodies.set(instanceId, body);
	colliders.set(instanceId, collider);
}

/**
 * Remove the body and its collider from the world.
 */
export function removeAgentBody(instanceId: string): void {
	const w = ensureWorld();

	const collider = colliders.get(instanceId);
	if (collider) {
		w.removeCollider(collider, true);
		colliders.delete(instanceId);
	}

	const body = bodies.get(instanceId);
	if (body) {
		w.removeRigidBody(body);
		bodies.delete(instanceId);
	}
}

/**
 * Set the translation of a kinematic body directly.
 */
export function setAgentPosition(instanceId: string, x: number, y: number): void {
	const body = bodies.get(instanceId);
	if (!body) return;
	body.setTranslation({ x, y }, true);
}

/**
 * Switch an agent body to dynamic mode with high linear damping.
 * This allows it to respond to forces/impulses and spring joints.
 */
export function makeAgentDynamic(instanceId: string): void {
	const body = bodies.get(instanceId);
	if (!body) return;
	body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
	body.setLinearDamping(10);
	body.setAngularDamping(10);
	body.setGravityScale(0, true);
}

/**
 * Switch an agent body back to kinematic position-based mode.
 */
export function makeAgentKinematic(instanceId: string): void {
	const body = bodies.get(instanceId);
	if (!body) return;
	body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
}

/**
 * Get the current translation of an agent body.
 */
export function getAgentPosition(instanceId: string): { x: number; y: number } | null {
	const body = bodies.get(instanceId);
	if (!body) return null;
	const t = body.translation();
	return { x: t.x, y: t.y };
}

// ---------------------------------------------------------------------------
// Element body operations
// ---------------------------------------------------------------------------

/**
 * Create a kinematic position-based rigid body with a cuboid collider
 * for a workshop element (pinboard, message board, inbox).
 */
export function addElementBody(instanceId: string, x: number, y: number, halfW = 50, halfH = 40): void {
	const w = ensureWorld();

	if (bodies.has(instanceId)) return;

	const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y);
	const body = w.createRigidBody(bodyDesc);

	const colliderDesc = RAPIER.ColliderDesc.cuboid(halfW, halfH).setRestitution(0.1);
	const collider = w.createCollider(colliderDesc, body);

	bodies.set(instanceId, body);
	colliders.set(instanceId, collider);
}

/**
 * Remove an element body (reuses removeAgentBody — same maps).
 */
export const removeElementBody = removeAgentBody;

/**
 * Set position of an element body (reuses setAgentPosition — same maps).
 */
export const setElementPosition = setAgentPosition;

// ---------------------------------------------------------------------------
// Spring joints
// ---------------------------------------------------------------------------

/**
 * Create a spring joint between two agent bodies.
 */
export function addSpringJoint(
	relationshipId: string,
	fromId: string,
	toId: string,
	restLength: number = 150,
	stiffness: number = 5,
	damping: number = 1
): void {
	const w = ensureWorld();

	if (joints.has(relationshipId)) return;

	const bodyA = bodies.get(fromId);
	const bodyB = bodies.get(toId);
	if (!bodyA || !bodyB) return;

	const anchor1 = { x: 0, y: 0 };
	const anchor2 = { x: 0, y: 0 };

	const jointData = RAPIER.JointData.spring(restLength, stiffness, damping, anchor1, anchor2);
	const joint = w.createImpulseJoint(jointData, bodyA, bodyB, true);

	joints.set(relationshipId, joint);
}

/**
 * Remove a spring joint from the world.
 */
export function removeSpringJoint(relationshipId: string): void {
	const w = ensureWorld();

	const joint = joints.get(relationshipId);
	if (joint) {
		w.removeImpulseJoint(joint, true);
		joints.delete(relationshipId);
	}
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Advance the physics simulation by one step.
 */
export function step(): void {
	const w = ensureWorld();
	w.step();
}

/**
 * Get a map of all agent positions keyed by instanceId.
 */
export function getAllPositions(): Map<string, { x: number; y: number }> {
	const positions = new Map<string, { x: number; y: number }>();
	for (const [id, body] of bodies) {
		const t = body.translation();
		positions.set(id, { x: t.x, y: t.y });
	}
	return positions;
}

// ---------------------------------------------------------------------------
// Wander behavior
// ---------------------------------------------------------------------------

/**
 * Apply a random wander impulse to a dynamic agent body.
 * If the body has drifted beyond `radius` from its home position,
 * a return force is applied toward home instead.
 */
export function applyWanderImpulse(
	instanceId: string,
	homeX: number,
	homeY: number,
	radius: number
): void {
	const body = bodies.get(instanceId);
	if (!body) return;
	if (body.bodyType() !== RAPIER.RigidBodyType.Dynamic) return;

	const pos = body.translation();
	const dx = pos.x - homeX;
	const dy = pos.y - homeY;
	const dist = Math.sqrt(dx * dx + dy * dy);

	if (dist > radius) {
		// Return force toward home, strength proportional to overshoot
		const strength = 0.5 * (dist - radius);
		const nx = -dx / dist;
		const ny = -dy / dist;
		body.applyImpulse({ x: nx * strength, y: ny * strength }, true);
	} else {
		// Random wander impulse
		const angle = Math.random() * Math.PI * 2;
		const magnitude = 2 + Math.random() * 3;
		body.applyImpulse(
			{ x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude },
			true
		);
	}
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Free the physics world and clear all tracking maps.
 */
export function destroyPhysics(): void {
	if (world) {
		world.free();
		world = null;
	}
	bodies.clear();
	colliders.clear();
	joints.clear();
	initialized = false;
}
