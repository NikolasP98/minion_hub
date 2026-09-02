/**
 * UI state the assistant's tools drive: the spotlight/coach-mark walkthrough
 * (Stage II "show me") and the intent-choice chips (learn vs do).
 */

export interface GuideStep {
  /** `data-assist` key, or a CSS selector as fallback. */
  target: string;
  message: string;
}

export interface ChoiceOption {
  label: string;
  /** Text sent as the user's next turn when picked. Defaults to the label. */
  value?: string;
}

interface GuideState {
  steps: GuideStep[];
  index: number;
  active: boolean;
  /** Last actions taken by the assistant, for the transcript chip row. */
  lastActions: string[];
}

export const guide = $state<GuideState>({
  steps: [],
  index: 0,
  active: false,
  lastActions: [],
});

export function startGuide(steps: GuideStep[]) {
  guide.steps = steps.filter((s) => s.target && s.message);
  guide.index = 0;
  guide.active = guide.steps.length > 0;
}

export function nextGuideStep() {
  if (guide.index + 1 >= guide.steps.length) return endGuide();
  guide.index += 1;
}

export function prevGuideStep() {
  if (guide.index > 0) guide.index -= 1;
}

export function endGuide() {
  guide.active = false;
  guide.steps = [];
  guide.index = 0;
}

/** Resolve a guide/highlight target to an element. `data-assist` keys first. */
export function resolveTarget(target: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const byKey = document.querySelector<HTMLElement>(`[data-assist="${CSS.escape(target)}"]`);
  if (byKey) return byKey;
  try {
    return document.querySelector<HTMLElement>(target);
  } catch {
    return null;
  }
}
