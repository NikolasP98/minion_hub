import { bindEffectLease } from './effect-lease';
/**
 * Executes the `minion-ui` calls found in a finished assistant reply, then —
 * only when the model needs to know something (an error, a read result, an
 * incomplete fill) — sends the results back as a silent follow-up turn.
 *
 * Runs ONLY for live `final` chat events, never for history reloads: a reply
 * loaded from the transcript must not re-navigate the user.
 */
import { executeTool, hasTool, isReadOnly, waitForTool } from './model-context';
import { parseUiBlocks, type UiCall } from './ui-blocks';
import { guide } from './guide.svelte';
import {
  beginInvocation,
  isRunCurrent,
  isInvocationEffectCurrent,
  settleInvocation,
  type AcceptedBinding,
} from './accepted-runs';

export interface UiCallOutcome {
  tool: string;
  result: string;
  /** The tool declared `readOnlyHint`: the model called it to learn something. */
  readOnly?: boolean;
  contextHandoff?: boolean;
  /** Terminal navigation proposal: no automatic continuation or replay. */
  requiresUserAction?: boolean;
}

/** Does the model need this batch's results to continue? */
export function needsFollowUp(outcomes: UiCallOutcome[]): boolean {
  if (outcomes.some((o) => o.requiresUserAction)) return false;
  return outcomes.some((o) => {
    if (o.readOnly) return true;
    try {
      const r = JSON.parse(o.result) as Record<string, unknown>;
      if (r.error) return true;
      if (Array.isArray(r.missing) && r.missing.length) return true;
      if (Array.isArray(r.rejected) && r.rejected.length) return true;
      if (Array.isArray(r.unknownTargets) && r.unknownTargets.length) return true;
      // A fuzzy entity match ("yaluronidasa" → "Hialuronidasa"): the model must
      // confirm with the corrected name, so it needs to see it.
      if (typeof r.note === 'string' && r.note) return true;
      // hub.navigate onto a form that never mounted: the model must not assume it can fill.
      if (
        r.form &&
        typeof r.form === 'object' &&
        (r.form as { mounted?: boolean }).mounted === false
      )
        return true;
    } catch {
      return true;
    }
    return false;
  });
}

export async function runUiCalls(
  calls: UiCall[],
  binding?: AcceptedBinding,
): Promise<UiCallOutcome[]> {
  const current = () => !binding || isRunCurrent(binding);
  const outcomes: UiCallOutcome[] = [];
  // Navigation remains a terminal proposal and excludes every old-page action.
  const selected = calls.some((c) => c.tool === 'hub.navigate')
    ? calls.filter((c) => c.tool === 'hub.navigate')
    : calls;
  for (const call of selected) {
    if (!current()) break;
    if (call.tool.startsWith('fill_') && !hasTool(call.tool)) {
      await waitForTool(call.tool, 6000, binding?.controller.signal);
      if (!current()) break;
    }
    if (!current()) break;
    const capability = binding ? beginInvocation(binding, call.tool) : undefined;
    const result = await executeTool(call.tool, call.input, {
      signal: binding?.controller.signal,
      capability,
      lease: binding
        ? bindEffectLease(
            { signal: binding.controller.signal },
            () => current() && (!capability || isInvocationEffectCurrent(capability)),
          )
        : undefined,
    });
    const handoff = settleInvocation(capability);
    if (!current()) break;
    outcomes.push({
      tool: call.tool,
      result,
      readOnly: isReadOnly(call.tool),
      requiresUserAction: call.tool === 'hub.navigate',
      contextHandoff: handoff,
    });
    if (call.tool !== 'hub.navigate') label(call, result);
    if (handoff || call.tool === 'hub.navigate') break;
  }
  return outcomes;
}

/** Transcript chip text for a call ("Opened /stock/entries", "Filled 3 fields"). */
function label(call: UiCall, result: string) {
  let r: Record<string, unknown> = {};
  try {
    r = JSON.parse(result);
  } catch {
    /* string result */
  }
  let text: string | null = null;
  if (r.error) text = `${call.tool}: ${String(r.error)}`;
  else if (call.tool.startsWith('fill_'))
    text = `Filled ${(r.filled as string[] | undefined)?.length ?? 0} field(s)`;
  else if (call.tool === 'ui.guide') text = `Walkthrough (${String(r.steps ?? '')} steps)`;
  if (text) guide.lastActions = [...guide.lastActions.slice(-4), text];
}

export function extractUiCalls(text: string): UiCall[] {
  return parseUiBlocks(text).calls;
}

/** Envelope text for the follow-up turn (stripped from display by the page-envelope regex). */
export function formatFollowUp(outcomes: UiCallOutcome[]): string {
  // A read result is the point of the call (the sandbox dataset catalog is ~6KB);
  // anything else only needs enough to explain the failure.
  const lines = outcomes.map((o) => `${o.tool} → ${o.result.slice(0, o.readOnly ? 8000 : 1500)}`);
  return (
    `[In-app assistant context — results of the UI tools you just called (not user text):\n` +
    lines.join('\n') +
    `\nContinue from these results. If a form is now on screen and you still lack required values, ask the user for them (one question at a time). Don't restate this context.]`
  );
}
