import type { VariableSpec } from '$lib/flows/master-flows';

export function extractHtml(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const i = t.search(/<!doctype html|<html/i);
  return i >= 0 ? t.slice(i).trim() : t;
}

export function validateBundle(html: string): void {
  // TODO(handoff): Enforce generated-code construction separately from these shallow checks;
  // a matching bridge region does not confine other scripts. See proposals/2026-09-08-platform-qc-remediation.md (14-07 generation follow-up).
  const h = html.trim();
  if (!h) throw new Error('builder returned empty output');
  if (!h.includes('<')) throw new Error('builder output is not HTML');
  if (!h.includes('hub.artifact.context.get'))
    throw new Error('builder output does not use the artifact context bridge');
  if (!/<script/i.test(h))
    throw new Error('builder output has no <script> (cannot use the bridge)');
  if (!/<!doctype|<html/i.test(h))
    throw new Error('builder output is a fragment (missing <!doctype>/<html>)');
}

export function buildRepairPrompt(basePrompt: string, previous: string, error: string): string {
  return [
    basePrompt,
    '',
    `Your previous attempt was REJECTED: ${error}`,
    'Here is what you produced — fix it and output ONLY the corrected, complete HTML document:',
    previous,
  ].join('\n');
}

export function buildRegeneratePrompt(args: {
  agent: { name: string; role: string; trigger: string };
  schema: VariableSpec[];
  currentHtml: string;
  refinement: string;
  reference: string;
}): string {
  const base = buildBuilderPrompt({
    agent: args.agent,
    schema: args.schema,
    userPrompt: `Refine the existing artifact: ${args.refinement}`,
    reference: args.reference,
  });
  return [
    base,
    '',
    'You are EDITING an existing artifact, not starting over. Apply this change and output the FULL updated HTML document:',
    args.refinement,
    '',
    'CURRENT ARTIFACT:',
    args.currentHtml,
  ].join('\n');
}

export function buildBuilderPrompt(args: {
  agent: { name: string; role: string; trigger: string };
  schema: VariableSpec[];
  userPrompt: string;
  reference: string;
}): string {
  const vars = args.schema.length
    ? args.schema
        .map(
          (s) =>
            `- ${s.key} (${s.type}) — ${s.label}${s.sample !== undefined ? `, e.g. ${JSON.stringify(s.sample)}` : ''}`,
        )
        .join('\n')
    : '(none — render the base fields only)';
  return [
    'You generate ONE self-contained HTML artifact (a small dashboard) for an AI agent.',
    'Output ONLY the HTML document — no prose, no markdown fences.',
    '',
    'CONTRACT (follow exactly):',
    '- Preserve the entire generated region between /* MINION_GENERATED_BRIDGE_START */ and /* MINION_GENERATED_BRIDGE_END */, including its markers, BYTE-FOR-BYTE from the reference.',
    '- Customize render(), its local helpers, markup and styles OUTSIDE that protected region. Keep the external generatedPluginBridge.mount({ render, fail }) invocation and a failure display callback. Do not add another message handler, RPC client, request identifier or origin fallback.',
    '- The protected adapter obtains context once per bridge lifetime and passes the complete payload to render(). Do not call the context method again from render().',
    '- Theme with the semantic --color-* custom properties applied from host:hello; no hard-coded hex except as var() fallbacks.',
    '- The protected bridge calls "hub.artifact.context.get". The context shape is:',
    '  { agentName, agentRole, agentDescription, status, trigger, vars: { <key>: value } }',
    '  where vars holds the agent variables listed below (bind to vars["the.key"]).',
    '- Render a loading state, an empty/missing state, and an error state.',
    '- Self-contained: inline CSS + JS only. No external network, CDN, fonts, or imports.',
    '',
    `AGENT: ${args.agent.name} — ${args.agent.role}. Trigger: ${args.agent.trigger}.`,
    'AVAILABLE VARIABLES (context.vars keys):',
    vars,
    '',
    `USER REQUEST: ${args.userPrompt}`,
    '',
    'REFERENCE ARTIFACT (preserve only the marked generated region verbatim; adapt the render + styles outside it):',
    args.reference,
  ].join('\n');
}
