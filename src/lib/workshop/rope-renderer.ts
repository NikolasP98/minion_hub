// src/lib/workshop/rope-renderer.ts

import * as PIXI from 'pixi.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

interface RopeEntry {
	graphics: PIXI.Graphics;
	label: PIXI.Text;
	/** 0..1, advances each frame when isActive */
	flowPhase: number;
}

const ropes = new Map<string, RopeEntry>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARTICLE_COUNT = 4;
/** Full cable traversal in ms */
const FLOW_PERIOD_MS = 2000;
const FLOW_SPEED = 1 / FLOW_PERIOD_MS;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Convert HSL values to a hex number.
 * h: 0-360, s: 0-100, l: 0-100
 */
function hslToHex(h: number, s: number, l: number): number {
	s /= 100;
	l /= 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r = 0,
		g = 0,
		b = 0;

	if (h < 60) {
		r = c;
		g = x;
	} else if (h < 120) {
		r = x;
		g = c;
	} else if (h < 180) {
		g = c;
		b = x;
	} else if (h < 240) {
		g = x;
		b = c;
	} else if (h < 300) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}

	const ri = Math.round((r + m) * 255);
	const gi = Math.round((g + m) * 255);
	const bi = Math.round((b + m) * 255);

	return (ri << 16) | (gi << 8) | bi;
}

/**
 * Deterministic color from a label string hash.
 * Hashes the string, extracts hue (0-360), saturation (50-80), lightness (55-70),
 * and converts HSL to hex number.
 */
function labelToColor(label: string): number {
	let hash = 0;
	for (let i = 0; i < label.length; i++) {
		hash = (hash * 31 + label.charCodeAt(i)) | 0;
	}
	// Make hash positive
	hash = Math.abs(hash);

	const hue = hash % 360;
	const saturation = 50 + (hash % 31); // 50-80
	const lightness = 55 + (hash % 16); // 55-70

	return hslToHex(hue, saturation, lightness);
}

/** Sample a point on a quadratic bezier at parameter t (0..1). */
function bezierPoint(
	t: number,
	fromX: number,
	fromY: number,
	cpX: number,
	cpY: number,
	toX: number,
	toY: number
): { x: number; y: number } {
	const ot = 1 - t;
	return {
		x: ot * ot * fromX + 2 * ot * t * cpX + t * t * toX,
		y: ot * ot * fromY + 2 * ot * t * cpY + t * t * toY,
	};
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Create a PIXI.Graphics and PIXI.Text for a rope.
 * Graphics is added at index 0 (behind sprites). Text is added on top.
 */
export function createRope(
	relationshipId: string,
	label: string,
	stage: PIXI.Container
): void {
	if (ropes.has(relationshipId)) return;

	const graphics = new PIXI.Graphics();
	const text = new PIXI.Text({
		text: label,
		style: {
			fontFamily: 'JetBrains Mono NF',
			fontSize: 9,
			fill: 0x888888
		}
	});

	// Graphics behind everything, text on top
	stage.addChildAt(graphics, 0);
	stage.addChild(text);

	ropes.set(relationshipId, { graphics, label: text, flowPhase: 0 });
}

/**
 * Redraw the rope as a cable with animated directional flow particles.
 *
 * @param dt          Elapsed ms since last frame — used to advance the flow animation.
 * @param flowDirection  1 = particles travel from→to, -1 = to→from.
 */
export function updateRope(
	relationshipId: string,
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	label: string,
	isActive: boolean = false,
	dt: number = 0,
	flowDirection: 1 | -1 = 1
): void {
	const entry = ropes.get(relationshipId);
	if (!entry) return;

	const { graphics, label: text } = entry;

	// Advance flow phase when active
	if (isActive && dt > 0) {
		entry.flowPhase = (entry.flowPhase + dt * FLOW_SPEED) % 1;
	}

	const dx = toX - fromX;
	const dy = toY - fromY;
	const dist = Math.sqrt(dx * dx + dy * dy);

	// Sag proportional to distance
	const sag = Math.min(dist * 0.15, 40);

	// Midpoint + control point (sag downward)
	const midX = (fromX + toX) / 2;
	const midY = (fromY + toY) / 2;
	const cpX = midX;
	const cpY = midY + sag;

	const color = labelToColor(label || relationshipId);

	graphics.clear();

	if (isActive) {
		// Outer glow
		graphics
			.moveTo(fromX, fromY)
			.quadraticCurveTo(cpX, cpY, toX, toY)
			.stroke({ width: 16, color, alpha: 0.07 });
	}

	// Cable body — dark jacket
	graphics
		.moveTo(fromX, fromY)
		.quadraticCurveTo(cpX, cpY, toX, toY)
		.stroke({ width: 5, color: 0x0d0d1a, alpha: isActive ? 0.85 : 0.65 });

	// Cable wire — colored core
	graphics
		.moveTo(fromX, fromY)
		.quadraticCurveTo(cpX, cpY, toX, toY)
		.stroke({ width: isActive ? 2.5 : 1.5, color, alpha: isActive ? 0.9 : 0.35 });

	// Flowing particles when active
	if (isActive) {
		for (let i = 0; i < PARTICLE_COUNT; i++) {
			let t = (entry.flowPhase + i / PARTICLE_COUNT) % 1;
			if (flowDirection === -1) t = 1 - t;

			// Fade: trailing particles dimmer, leading brighter
			// For dir=1: particle i=PARTICLE_COUNT-1 is leading (largest base t before wrap)
			// For dir=-1: particle i=0 is leading (inverted)
			const leadIndex = flowDirection === 1 ? PARTICLE_COUNT - 1 : 0;
			const distFromLead = Math.abs(i - leadIndex);
			const alpha = 0.95 - distFromLead * 0.18;

			const { x: px, y: py } = bezierPoint(t, fromX, fromY, cpX, cpY, toX, toY);
			graphics.circle(px, py, 3).fill({ color: 0xffffff, alpha });
		}
	}

	// Label text (only for named ropes)
	if (label) {
		const labelX = 0.25 * fromX + 0.5 * cpX + 0.25 * toX;
		const labelY = 0.25 * fromY + 0.5 * cpY + 0.25 * toY;
		text.x = labelX;
		text.y = labelY;
		text.text = label;
	} else {
		text.text = '';
	}
}

/**
 * Remove a rope from its parent, destroy it, and delete from map.
 */
export function removeRope(relationshipId: string): void {
	const entry = ropes.get(relationshipId);
	if (!entry) return;

	const { graphics, label } = entry;

	if (graphics.parent) graphics.parent.removeChild(graphics);
	graphics.destroy();

	if (label.parent) label.parent.removeChild(label);
	label.destroy();

	ropes.delete(relationshipId);
}

/**
 * Destroy and clear all ropes.
 */
export function clearAllRopes(): void {
	for (const [id] of ropes) {
		removeRope(id);
	}
	ropes.clear();
}

/**
 * Returns the relationshipId if the point is within threshold+20 of any
 * rope's label position, or null.
 */
export function getRopeAtPoint(
	x: number,
	y: number,
	threshold: number = 10
): string | null {
	const maxDist = threshold + 20;

	for (const [id, entry] of ropes) {
		const lx = entry.label.x;
		const ly = entry.label.y;
		const dx = x - lx;
		const dy = y - ly;
		const dist = Math.sqrt(dx * dx + dy * dy);

		if (dist <= maxDist) {
			return id;
		}
	}

	return null;
}
