import { describe, it, expect } from 'vitest';
import { detectTrigger, applySuggestion, matches } from './chat-suggest';

describe('detectTrigger', () => {
	it('detects @ mid-sentence', () => {
		expect(detectTrigger('hi @nik', 7)).toEqual({ char: '@', query: 'nik', start: 3, end: 7 });
	});
	it('detects / at start of text', () => {
		expect(detectTrigger('/notes', 6)).toEqual({ char: '/', query: 'notes', start: 0, end: 6 });
	});
	it('keeps dot notation in the query', () => {
		expect(detectTrigger('@nik.wha', 8)?.query).toBe('nik.wha');
	});
	it('rejects a mid-word trigger (email)', () => {
		expect(detectTrigger('me@ex', 5)).toBeNull();
	});
	it('closes once whitespace follows the token', () => {
		expect(detectTrigger('@nik ', 5)).toBeNull();
	});
});

describe('applySuggestion', () => {
	it('replaces the token in place and returns the caret', () => {
		const r = applySuggestion(
			'hi @nik',
			{ char: '@', query: 'nik', start: 3, end: 7 },
			'nikolas.whatsapp',
		);
		expect(r.text).toBe('hi @nikolas.whatsapp ');
		expect(r.caret).toBe(21);
	});
});

describe('matches', () => {
	it('is case-insensitive substring', () => {
		expect(matches('Apple Notes', 'note')).toBe(true);
		expect(matches('Apple Notes', 'xyz')).toBe(false);
	});
});
