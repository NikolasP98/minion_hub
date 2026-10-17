// Expressions and eye geometry for AiOrbFace — ported from SmoothUI
// `ai-orb-face` (MIT, © 2024 Eduardo Calvo). An expression is two eyes; an eye
// is a rounded capsule described by four numbers (height, width, tilt, offset).
// No mouth: on a shader body a drawn mouth reads as a sticker. Spec 019 A.

export type FaceState = 'idle' | 'listening' | 'thinking' | 'streaming' | 'done' | 'error';

export interface EyeShape {
  /** Multiplier on the resting height. `0` is a shut eye. */
  h: number;
  /** Multiplier on the resting width. */
  w: number;
  /** Degrees. Positive tilts the inner corner down (a scowl). */
  rotate?: number;
  /** Vertical offset in viewBox units. Negative sits higher. */
  dy?: number;
}
export interface Expression {
  left: EyeShape;
  right: EyeShape;
}

const eye = (h: number, w = 1, rotate = 0, dy = 0): EyeShape => ({ h, w, rotate, dy });
/** The same tilt on both eyes, pointing at each other. */
const symmetric = (h: number, w = 1, rotate = 0, dy = 0): Expression => ({
  left: eye(h, w, rotate, dy),
  right: eye(h, w, -rotate, dy),
});

export const EXPRESSIONS = {
  alert: symmetric(1.2, 1.05, 0, -1),
  content: symmetric(0.16, 1.25, 0, 2),
  cross: symmetric(0.85, 1, 18),
  deadpan: symmetric(0.14, 1.35),
  doubtful: { left: eye(1, 1), right: eye(0.45, 1.1, -14) },
  focused: symmetric(0.55, 1.05),
  neutral: symmetric(1),
  surprised: symmetric(0.5, 0.55, 0, -3),
  wink: { left: eye(1, 1), right: eye(0.12, 1.2, 0, 2) },
} satisfies Record<string, Expression>;

export type ExpressionName = keyof typeof EXPRESSIONS;

/** Status is carried by expression — the thing people read fastest. */
export const STATE_EXPRESSION: Record<FaceState, ExpressionName> = {
  done: 'content',
  error: 'cross',
  idle: 'neutral',
  listening: 'alert',
  streaming: 'focused',
  thinking: 'doubtful',
};

/** Error desaturates instead of growing; idle rests a little muted. */
export const STATE_SATURATION: Record<FaceState, number> = {
  done: 1,
  error: 0.3,
  idle: 0.75,
  listening: 1.05,
  streaming: 1,
  thinking: 1,
};

export const VIEWBOX = 100;
const CENTER = VIEWBOX / 2;
export const EYE_OFFSET = 16;
export const EYE_Y = 44;
const EYE_WIDTH = 11;
export const EYE_HEIGHT = 26;
const EYE_RADIUS = 5.5;
/** How far the pupils can travel from centre, in viewBox units. */
export const GAZE_RANGE = 5.5;
/** Cursor distance in px at which the gaze reaches full deflection. */
export const GAZE_FALLOFF = 220;
/** A ~1.25-turn swirl; spun in place it reads as dizzy. */
export const SPIRAL = 'M0 0C-0.6 -4 5 -5 6 -0.6C7 4.5 1 8 -4 6C-9 4.5 -9.5 -2 -6 -6';
/** Thinking: the eyes look away and up, the way people search. */
export const SACCADE_TARGETS = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -0.6, y: -0.4 },
  { x: 0.8, y: -0.9 },
] as const;

export function resolveExpression(
  state: FaceState,
  expression?: ExpressionName | Expression,
): Expression {
  if (typeof expression === 'object') return expression;
  if (expression) return EXPRESSIONS[expression];
  return EXPRESSIONS[STATE_EXPRESSION[state] ?? 'neutral'];
}

/**
 * A capsule at any height. The eye stays centred as it opens and closes, so a
 * squint reads as lids meeting rather than the eye sliding up the face, and the
 * radius follows the height down into a lozenge instead of squashing a corner.
 */
export function eyeGeometry(shape: EyeShape, side: -1 | 1) {
  const width = EYE_WIDTH * shape.w;
  const height = Math.max(EYE_HEIGHT * shape.h, 0.5);
  const x = CENTER + side * EYE_OFFSET - width / 2;
  const y = EYE_Y + (EYE_HEIGHT - height) / 2 + (shape.dy ?? 0);
  return {
    x,
    y,
    width,
    height,
    rx: Math.min(EYE_RADIUS * shape.w, height / 2),
    cx: x + width / 2,
    cy: y + height / 2,
    rotate: shape.rotate ?? 0,
  };
}

/** Pointer offset (px from the face centre) → gaze offset in viewBox units. */
export function gazeFor(dx: number, dy: number) {
  const reach = Math.min(1, Math.hypot(dx, dy) / GAZE_FALLOFF) * GAZE_RANGE;
  const angle = Math.atan2(dy, dx);
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
}

/** The voice call's states, as the face shows them (speaking = streaming). */
export function voiceFaceState(status: 'idle' | 'listening' | 'thinking' | 'speaking'): FaceState {
  return status === 'speaking' ? 'streaming' : status;
}

/** A chat's live state, as the face shows it. */
export function chatFaceState(
  c: { sending?: boolean; stream?: string | null; lastError?: string | null } | null | undefined,
): FaceState {
  if (!c) return 'idle';
  if (c.lastError) return 'error';
  if (c.stream) return 'streaming';
  if (c.sending || c.stream === '') return 'thinking';
  return 'idle';
}

/** Five amplitude buckets: enough to see the interior stir, few enough re-renders. */
export const energyBucket = (level: number) => Math.round(Math.min(1, Math.max(0, level)) * 4) / 4;
