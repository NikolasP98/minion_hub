import type { VariableSpec } from '$lib/flows/master-flows';

export function extractHtml(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const i = t.search(/<!doctype html|<html/i);
  return i >= 0 ? t.slice(i).trim() : t;
}

export function validateBundle(html: string): void {
  const h = html.trim();
  if (!h) throw new Error('builder returned empty output');
  if (!h.includes('<')) throw new Error('builder output is not HTML');
  if (!h.includes('hub.artifact.context.get'))
    throw new Error('builder output does not use the artifact context bridge');
  if (!/<script/i.test(h)) throw new Error('builder output has no <script> (cannot use the bridge)');
  if (!/<!doctype|<html/i.test(h)) throw new Error('builder output is a fragment (missing <!doctype>/<html>)');
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
  const base = buildBuilderPrompt({ agent: args.agent, schema: args.schema, userPrompt: `Refine the existing artifact: ${args.refinement}`, reference: args.reference });
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
    ? args.schema.map((s) => `- ${s.key} (${s.type}) — ${s.label}${s.sample !== undefined ? `, e.g. ${JSON.stringify(s.sample)}` : ''}`).join('\n')
    : '(none — render the base fields only)';
  return [
    'You generate ONE self-contained HTML artifact (a small dashboard) for an AI agent.',
    'Output ONLY the HTML document — no prose, no markdown fences.',
    '',
    'CONTRACT (follow exactly):',
    "- Reuse the reference's <script> bridge client VERBATIM — the plugin:ready / host:hello / hub.artifact.context.get handshake and origin checks MUST be byte-identical. Only change the render() body + the markup/styles.",
    '- Theme with the semantic --color-* custom properties applied from host:hello; no hard-coded hex except as var() fallbacks.',
    '- Get data by calling the bridge for "hub.artifact.context.get". The context shape is:',
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
    'REFERENCE ARTIFACT (copy its bridge <script> verbatim; adapt the render + styles):',
    args.reference,
  ].join('\n');
}
