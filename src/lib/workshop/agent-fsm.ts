/**
 * Agent Finite State Machine
 *
 * Uses runed's FiniteStateMachine to control agent behavior on the workshop
 * canvas. The FSM replaces the static `behavior` string with reactive state
 * transitions that respond to conversation events, user actions, and timers.
 *
 * The `.current` property is Svelte 5 `$state` reactive — any component or
 * derived reading it will update automatically.
 */

import { FiniteStateMachine } from 'runed';
import { setSpriteGlowColor, triggerHeartbeatPulse } from './agent-sprite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentFsmState =
	| 'idle'
	| 'wandering'
	| 'patrolling'
	| 'conversing'
	| 'cooldown'
	| 'dragged'    // user is holding this agent
	| 'heartbeat'  // brief awareness pulse when idle too long
	| 'reading';   // agent is processing an environment element

export type AgentFsmEvent =
	| 'wander'
	| 'patrol'
	| 'stop'
	| 'conversationStart'
	| 'conversationEnd'
	| 'cooldownExpired'
	| 'pickUp'           // user grabbed the agent
	| 'putDown'          // user released the agent
	| 'heartbeatTrigger' // fired by simulation timer
	| 'heartbeatEnd'     // fired after heartbeat duration expires
	| 'startReading'     // agent begins processing an environment element
	| 'stopReading';     // agent finishes processing an environment element

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Active FSMs keyed by agent instanceId */
const fsmMap = new Map<string, FiniteStateMachine<AgentFsmState, AgentFsmEvent>>();

/** Prior movement state before entering conversation, for restoration */
const priorMovement = new Map<string, 'idle' | 'wandering' | 'patrolling'>();

/** Prior state before drag, for restoration on putDown */
const priorDragState = new Map<string, AgentFsmState>();

/** Prior state before reading, for restoration on stopReading */
const priorReadingState = new Map<string, AgentFsmState>();

/** Callback invoked when an agent enters heartbeat state (registered by simulation) */
let heartbeatEnterCallback: ((instanceId: string) => void) | null = null;

// ---------------------------------------------------------------------------
// Glow color palette
// ---------------------------------------------------------------------------

const GLOW_COLORS: Record<AgentFsmState, number> = {
	idle: 0x6366f1,      // indigo (default)
	wandering: 0x3b82f6, // blue
	patrolling: 0x8b5cf6, // purple
	conversing: 0x22c55e, // green
	cooldown: 0xf97316,  // orange
	dragged: 0xfbbf24,   // gold
	heartbeat: 0x67e8f9, // bright cyan
	reading: 0xf59e0b,   // amber
};

const COOLDOWN_MS = 4000;
const HEARTBEAT_DURATION_MS = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function behaviorToState(behavior: string): AgentFsmState {
	switch (behavior) {
		case 'wander':
			return 'wandering';
		case 'patrol':
			return 'patrolling';
		default:
			return 'idle';
	}
}

/** Map a movement-related FSM state back to the legacy behavior string */
export function stateToLegacyBehavior(state: AgentFsmState): 'stationary' | 'wander' | 'patrol' {
	switch (state) {
		case 'wandering':
			return 'wander';
		case 'patrolling':
			return 'patrol';
		default:
			return 'stationary';
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a callback invoked whenever any agent enters the `heartbeat` state.
 * Call from simulation to trigger awareness scans.
 */
export function setHeartbeatEnterCallback(fn: ((instanceId: string) => void) | null): void {
	heartbeatEnterCallback = fn;
}

/**
 * Create an FSM for an agent instance. Call when adding an agent to the canvas.
 */
export function createAgentFsm(
	instanceId: string,
	initialBehavior: 'stationary' | 'wander' | 'patrol',
): FiniteStateMachine<AgentFsmState, AgentFsmEvent> {
	const initial = behaviorToState(initialBehavior);

	const fsm = new FiniteStateMachine<AgentFsmState, AgentFsmEvent>(initial, {
		idle: {
			wander: 'wandering',
			patrol: 'patrolling',
			heartbeatTrigger: 'heartbeat',
			conversationStart: () => {
				priorMovement.set(instanceId, 'idle');
				return 'conversing';
			},
			_enter() {
				setSpriteGlowColor(instanceId, GLOW_COLORS.idle);
			},
		},

		wandering: {
			stop: 'idle',
			patrol: 'patrolling',
			conversationStart: () => {
				priorMovement.set(instanceId, 'wandering');
				return 'conversing';
			},
			_enter() {
				setSpriteGlowColor(instanceId, GLOW_COLORS.wandering);
			},
		},

		patrolling: {
			stop: 'idle',
			wander: 'wandering',
			conversationStart: () => {
				priorMovement.set(instanceId, 'patrolling');
				return 'conversing';
			},
			_enter() {
				setSpriteGlowColor(instanceId, GLOW_COLORS.patrolling);
			},
		},

		conversing: {
			conversationEnd: 'cooldown',
			_enter() {
				setSpriteGlowColor(instanceId, GLOW_COLORS.conversing);
			},
		},

		cooldown: {
			cooldownExpired: () => {
				const prior = priorMovement.get(instanceId) ?? 'idle';
				priorMovement.delete(instanceId);
				return prior;
			},
			conversationStart: () => {
				// Don't overwrite priorMovement — keep the original
				return 'conversing';
			},
			_enter() {
				setSpriteGlowColor(instanceId, GLOW_COLORS.cooldown);
				fsm.debounce(COOLDOWN_MS, 'cooldownExpired');
			},
		},

		dragged: {
			putDown: () => {
				const prior = priorDragState.get(instanceId) ?? 'idle';
				priorDragState.delete(instanceId);
				return prior;
			},
			_enter() {
				setSpriteGlowColor(instanceId, GLOW_COLORS.dragged);
			},
		},

		heartbeat: {
			heartbeatEnd: 'idle',
			wander: 'wandering', // awareness scan may set a wander target and transition here
			conversationStart: () => {
				priorMovement.set(instanceId, 'idle');
				return 'conversing';
			},
			_enter() {
				setSpriteGlowColor(instanceId, GLOW_COLORS.heartbeat);
				triggerHeartbeatPulse(instanceId);
				heartbeatEnterCallback?.(instanceId);
				fsm.debounce(HEARTBEAT_DURATION_MS, 'heartbeatEnd');
			},
		},

		reading: {
			stopReading: () => {
				const prior = priorReadingState.get(instanceId) ?? 'idle';
				priorReadingState.delete(instanceId);
				return prior;
			},
			_enter() {
				setSpriteGlowColor(instanceId, GLOW_COLORS.reading);
			},
		},

		'*': {
			stop: 'idle',
			pickUp: () => {
				const cur = fsm.current;
				if (cur !== 'dragged' && cur !== 'heartbeat') {
					priorDragState.set(instanceId, cur);
				}
				return 'dragged';
			},
			startReading: () => {
				const cur = fsm.current;
				if (cur !== 'reading' && cur !== 'dragged') {
					priorReadingState.set(instanceId, cur);
				}
				return 'reading';
			},
		},
	});

	fsmMap.set(instanceId, fsm);
	return fsm;
}

/**
 * Destroy an agent's FSM. Call when removing an agent from the canvas.
 */
export function destroyAgentFsm(instanceId: string): void {
	fsmMap.delete(instanceId);
	priorMovement.delete(instanceId);
	priorDragState.delete(instanceId);
	priorReadingState.delete(instanceId);
}

/**
 * Get an agent's FSM instance.
 */
export function getAgentFsm(
	instanceId: string,
): FiniteStateMachine<AgentFsmState, AgentFsmEvent> | undefined {
	return fsmMap.get(instanceId);
}

/**
 * Send an event to an agent's FSM. No-op if the agent has no FSM.
 */
export function sendFsmEvent(instanceId: string, event: AgentFsmEvent): void {
	fsmMap.get(instanceId)?.send(event);
}

/**
 * Check if an agent is currently busy (conversation, cooldown, dragged, or reading).
 * Used by simulation to exclude agents from idle banter selection.
 */
export function isAgentConversing(instanceId: string): boolean {
	const state = fsmMap.get(instanceId)?.current;
	return state === 'conversing' || state === 'cooldown' || state === 'dragged' || state === 'reading';
}

/**
 * Get the current FSM state for an agent, or null if no FSM exists.
 */
export function getAgentState(instanceId: string): AgentFsmState | null {
	return fsmMap.get(instanceId)?.current ?? null;
}

/**
 * Clear all FSMs. Call on workshop reset or host disconnect.
 */
export function clearAllFsms(): void {
	fsmMap.clear();
	priorMovement.clear();
	priorDragState.clear();
	priorReadingState.clear();
}
