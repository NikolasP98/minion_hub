/**
 * The one state value a chat surface hands to its composer and its live turn,
 * so the pieces move together (pattern from SmoothUI `ai-core`, MIT).
 */
export type AIState = 'idle' | 'thinking' | 'streaming' | 'done' | 'error';

/** Tool lifecycle as the status ring draws it. */
/** `idle` = finished turn with no recorded result: a static ring, no claim either way. */
export type AIToolStatus = 'idle' | 'pending' | 'running' | 'success' | 'error';

/** One reasoning trace or tool call in a turn's folded step line (AiSteps). */
export interface AIStep {
  kind: 'thinking' | 'tool';
  status: AIToolStatus;
}
