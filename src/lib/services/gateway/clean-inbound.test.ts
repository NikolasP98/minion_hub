import { describe, test, expect } from 'vitest';
import { cleanInboundForDisplay } from './chat-rpc';

// The exact shape the gateway records as the user turn (memories + metadata +
// timestamp + page envelope + the actual question), from a prod transcript.
const COMPOSED = [
	'## Relevant memories',
	'- Your top customer **[Jhon Oswaldo Baltazar Chavez](/crm/59cfa31b)** —',
	'- the user in the Minion dashboard for FACES SCULPTORS',
	'- the user in the Minion dashboard for FACES SCULPTORS',
	'',
	'Conversation info (untrusted metadata):',
	'```json',
	'{',
	'  "message_id": "334d3e2a-8cc7-42b9-a833-ed0b3383c6a3",',
	'  "sender": "minion-control-ui"',
	'}',
	'```',
	'',
	"[Thu 2026-06-25 12:00 GMT-5] [In-app assistant context — the user is in the Minion dashboard for FACES SCULPTORS. Current page: /finances/invoices — Invoices list. Keep replies tight. Don't restate this context.] Who has the highest ticket?",
].join('\n');

describe('cleanInboundForDisplay', () => {
	test('strips ALL injected blocks, leaving only the typed question', () => {
		expect(cleanInboundForDisplay(COMPOSED)).toBe('Who has the highest ticket?');
	});

	test('already-clean message is unchanged', () => {
		expect(cleanInboundForDisplay('what page am I on?')).toBe('what page am I on?');
	});

	test('strips just the timestamp + envelope when no memories/metadata', () => {
		const t =
			"[Thu 2026-06-25 12:00 GMT-5] [In-app assistant context — x. Don't restate this context.] hello";
		expect(cleanInboundForDisplay(t)).toBe('hello');
	});

	test('keeps a user message that merely mentions a bracket', () => {
		expect(cleanInboundForDisplay('show me [the report]')).toBe('show me [the report]');
	});

	test('does not eat multi-paragraph user text', () => {
		expect(cleanInboundForDisplay('line one\n\nline two')).toBe('line one\n\nline two');
	});
});
