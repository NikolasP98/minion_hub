import { describe, test, expect } from 'vitest';
import { stripAssistantContext } from './chat-rpc';

describe('stripAssistantContext', () => {
	test('removes the full envelope (incl. internal [label](/path) brackets) leaving clean text', () => {
		const envelope =
			"[In-app assistant context — the user is in the Minion dashboard for FACES.\n" +
			'Current page: /finances/invoices — Invoices list.\n' +
			'To take the user somewhere, write [label](/path) — e.g. [3 invoices](/finances/invoices?contact={id}).\n' +
			"Keep replies tight. Don't restate this context.]\n\n";
		expect(stripAssistantContext(envelope + 'who has the highest ticket?')).toBe(
			'who has the highest ticket?',
		);
	});

	test('leaves a normal message untouched', () => {
		expect(stripAssistantContext('hello there')).toBe('hello there');
	});

	test('only strips a LEADING envelope, not the user text after it', () => {
		const out = stripAssistantContext(
			"[In-app assistant context — x. Don't restate this context.]\n\nreal question [link](/crm/1)",
		);
		expect(out).toBe('real question [link](/crm/1)');
	});
});
