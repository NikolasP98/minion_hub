/**
 * Shared types for workshop Yjs collaboration.
 */

/** Room ID format: "workshop:{saveId}" */
export type WorkshopRoomId = `workshop:${string}`;

/** A single agent position update within the workshop canvas. */
export interface PositionUpdate {
	instanceId: string;
	x: number;
	y: number;
}

/** Host → guest broadcast of all current agent positions. */
export interface PositionBroadcast {
	positions: PositionUpdate[];
	authorityConnId: string;
	timestamp: number;
}

/** Request to acquire a drag lock on a workshop agent sprite. */
export interface DragLockRequest {
	instanceId: string;
	connId: string;
}

/** Release a previously-held drag lock. */
export interface DragLockRelease {
	instanceId: string;
	connId: string;
}

/** Current state of all active drag locks. */
export interface DragLockState {
	locks: Map<string, string>; // instanceId → connId
}
