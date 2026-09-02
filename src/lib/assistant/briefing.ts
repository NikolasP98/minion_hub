/**
 * The UI-tools section of the per-turn context envelope: the WebMCP-shaped
 * tools registered on the current page (global navigation/guide/choice + any
 * mounted form), the gated page list, the form catalog, the invocation
 * protocol and the intent rules. Pure — the caller injects the gated inputs.
 *
 * ponytail: shipped every turn (~2-3KB); the static parts move to the agent's
 * system prompt / hub_pages once the gateway exposes per-session context
 * (proposal 2026-09-02-gateway-client-tools-webmcp-bridge).
 */
import type { ToolDescriptor } from './model-context';
import { describePages, type SitePage } from './site-map';
import { describeForm, type FormDef } from './forms';

export const UI_TOOL_RULES = [
  '(1) A QUESTION ("where/how do I…", "¿dónde/cómo…?") is never ambiguous: navigate there (open the create form when the question is about adding/creating) and explain in ≤3 short steps. Do not ask learn-vs-do.',
  '(2) "show me how" / "teach me" / "enséñame" → navigate, then ui.guide with one step per field (target = <form_id>.<field_key>).',
  '(3) An instruction with values ("add 4 boxes of X at 1200", "registra la factura F001-123…") → navigate + fill_<id> with every value the user gave, then tell them what is missing and to review & submit — you never submit.',
  '(4) Only when the user states a goal with NO question and NO values ("I need to add stock", "necesito registrar una compra") call ui.choice with exactly two options: "Show me how" and "Do it for me" (translate to the user\'s language).',
  '(5) A module or page that does not exist here (anything only listed after "NO MODULE HERE for"): your FIRST sentence says it does not exist in this dashboard; then offer (or open) the nearest page. Never claim a page "covers" or "includes" a feature that is not in its title or description; never invent a path.',
  '(6b) Entity fields (item, customer, service, warehouse…) are matched fuzzily by the page: pass exactly what the user said (typos, accents and partial names are fine) and let the fill result tell you what it matched or which candidates exist.',
  '(6) Explain a field only when asked or when it is required and missing; ask for missing required fields one at a time, in form order. Short answers unless the user asks for detail.',
  '(7) Reply in the language the user wrote in; when unclear, use the UI language given in context.',
].join(' ');

export function uiToolsBriefing(
  tools: ToolDescriptor[],
  pages: SitePage[],
  forms: FormDef[],
  locale = 'en',
): string {
  if (tools.length === 0) return '';
  const toolLines = tools
    .map((t) => `${t.name}: ${t.description} input=${JSON.stringify(t.inputSchema)}`)
    .join('\n');
  const formLines = forms.map(describeForm).join('\n');
  return [
    `UI TOOLS — you can act on the dashboard. To call a tool, put a fenced block in your reply:`,
    '```minion-ui',
    '{"tool":"hub.navigate","input":{"path":"/stock/entries/new","params":{"type":"receipt"}}}',
    '```',
    `Exactly that shape: the opener line is only \`\`\`minion-ui, the JSON object is on its own line, then the closing \`\`\`. These UI tools are NOT function-calling tools: never invoke hub.navigate / ui.guide / ui.choice / fill_* as a tool call, and never use chat_artifact for a choice — write the fence in your text reply. One JSON object per block, several blocks allowed, executed in order after your reply. The block is hidden from the user, so also say in one short sentence what you did. Results come back to you only when something failed or a form needs values.`,
    `Available now:\n${toolLines}`,
    `Pages you may open (path — title):\n${describePages(pages)}`,
    formLines
      ? `Forms you can fill (fill_<id> appears once the form is on screen; hub.navigate to its route with its open params first, then call fill_<id> in the SAME reply — the fill waits for the form to mount). * = required. Field key: type[options]:\n${formLines}`
      : '',
    `UI language: ${locale}. Intent rules: ${UI_TOOL_RULES}`,
  ]
    .filter(Boolean)
    .join('\n');
}
