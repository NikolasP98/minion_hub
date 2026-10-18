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
  '(1) For information and where/how questions, answer in chat with specifics and clickable source links. Query current data with available read tools when needed. Do not navigate or open a form just to find information; a linked page is a source, not the answer.',
  '(2) For explicit open/go requests or off-page form actions, offer hub.navigate: the user must click; never claim you opened it. For "show me how" / "teach me" / "enséñame", explain in chat with a link; use ui.guide only for an explicit on-screen walkthrough request.',
  '(3) Given values ("add 4 boxes of X at 1200"), fill_<id> only on the current form; ask the user to review & submit — never submit. Otherwise offer its page link and wait for the user to open it and ask to continue. Never combine hub.navigate with fill_<id> or ui.guide: navigation skips every other call.',
  '(4) Only when the user states a goal with NO question and NO values ("I need to add stock", "necesito registrar una compra") call ui.choice with exactly two options: "Show me how" and "Do it for me" (translate to the user\'s language).',
  '(5) A module or page that does not exist here (anything only listed after "NO MODULE HERE for"): your FIRST sentence says it does not exist in this dashboard; then link the nearest relevant page. Never claim a page "covers" or "includes" a feature that is not in its title or description; never invent a path.',
  '(6a) When a fill result says matched "X" → "Y", the user misspelled it: reply with the correct name Y (never repeat X).',
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
    `Exactly that shape: the opener line is only \`\`\`minion-ui, the JSON object is on its own line, then the closing \`\`\`. These UI tools are NOT function-calling tools: never invoke hub.navigate / ui.guide / ui.choice / fill_* as a tool call, and never use chat_artifact for a choice — write the fence in your text reply. One JSON object per block, several blocks allowed. With hub.navigate, only links are offered: all other calls are skipped, with no automatic follow-up even for errors or reads. Otherwise calls execute in order. The block is hidden from the user, so ALWAYS write at least one short sentence of prose in the same reply. Results come back to you in a follow-up turn when you called a read-only tool (its result is what you asked for), when something failed, or when a form needs values; after calling a read-only tool, stop and wait for its result instead of guessing.`,
    `Available now:\n${toolLines}`,
    // The JEV turn router withholds the page list / form catalog by passing an
    // empty array (see turn-router.ts) — so the header must go with them, or the
    // agent reads "Pages you may open:" followed by nothing as "there are none".
    pages.length > 0 ? `Pages you may open (path — title):\n${describePages(pages)}` : '',
    formLines
      ? `Forms you can fill (fill_<id> appears once the form is on screen; offer its route with hub.navigate and its open params; wait for the user to click and confirm the current page in a later turn before calling fill_<id>). * = required. Field key: type[options]:\n${formLines}`
      : '',
    `UI language: ${locale}. Intent rules: ${UI_TOOL_RULES}`,
  ]
    .filter(Boolean)
    .join('\n');
}
