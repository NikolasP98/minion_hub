import { describe, it, expect } from 'vitest';
import { varAccessor, querySnippet, sqlTemplate } from './tool-editor-snippets';

describe('tool-editor-snippets', () => {
	it('varAccessor per language', () => {
		expect(varAccessor('javascript', 'FOO')).toBe('process.env.FOO');
		expect(varAccessor('python', 'FOO')).toBe('os.environ["FOO"]');
		expect(varAccessor('bash', 'FOO')).toBe('"$FOO"');
	});

	it('querySnippet embeds the path and token for every language', () => {
		for (const lang of ['javascript', 'python', 'bash'] as const) {
			const s = querySnippet(lang, '/api/gateway/query/notes');
			expect(s).toContain('/api/gateway/query/notes');
			expect(s).toContain('MINION_HUB_TOKEN');
			expect(s).toContain('MINION_AGENT_ID');
		}
	});

	it('sqlTemplate lists columns, falls back to *', () => {
		expect(sqlTemplate('stk_entries', [{ name: 'id' }, { name: 'qty' }])).toContain('SELECT id, qty');
		expect(sqlTemplate('empty', [])).toContain('SELECT *');
	});
});
