import { describe, it, expect } from 'vitest';
import { validateTypeScript, validatePython, validateSyntax } from './syntax-validator';

describe('validateTypeScript', () => {
	it('returns no errors for valid TypeScript', () => {
		const errors = validateTypeScript('const a: number = 1;\nconst b = "hello";', 'test.ts');
		expect(errors).toEqual([]);
	});

	it('catches syntax errors', () => {
		const errors = validateTypeScript('const a = {;', 'test.ts');
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0].severity).toBe('error');
		expect(errors[0].file).toBe('test.ts');
	});

	it('catches missing closing brace', () => {
		const errors = validateTypeScript('function foo() {\n  return 1;\n', 'test.ts');
		expect(errors.length).toBeGreaterThan(0);
	});

	it('handles TSX content', () => {
		const errors = validateTypeScript('const x = <div>hello</div>;', 'test.tsx');
		expect(errors).toEqual([]);
	});

	it('handles JSX content', () => {
		const errors = validateTypeScript('const x = <div>hello</div>;', 'test.jsx');
		expect(errors).toEqual([]);
	});
});

describe('validatePython', () => {
	it('returns no errors for valid Python', () => {
		const errors = validatePython('def foo():\n    return 1\n\nx = foo()\n', 'test.py');
		expect(errors).toEqual([]);
	});

	it('catches unmatched parenthesis', () => {
		const errors = validatePython('print("hello"\n', 'test.py');
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.message.includes('parenthesis'))).toBe(true);
	});

	it('catches unmatched closing bracket', () => {
		const errors = validatePython('x = ]', 'test.py');
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.message.includes('bracket'))).toBe(true);
	});

	it('catches unterminated string', () => {
		const errors = validatePython('x = "hello\n', 'test.py');
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.message.includes('string'))).toBe(true);
	});

	it('handles triple-quoted strings correctly', () => {
		const errors = validatePython('x = """\nmultiline\nstring\n"""\n', 'test.py');
		expect(errors).toEqual([]);
	});

	it('catches unterminated triple-quoted string', () => {
		const errors = validatePython('x = """\nnever closed\n', 'test.py');
		expect(errors.length).toBeGreaterThan(0);
	});

	it('ignores comments', () => {
		const errors = validatePython('# this is a comment with (\nx = 1\n', 'test.py');
		expect(errors).toEqual([]);
	});
});

describe('validateSyntax', () => {
	it('routes .ts files to TypeScript validator', () => {
		const errors = validateSyntax('const a = {;', 'test.ts');
		expect(errors.length).toBeGreaterThan(0);
	});

	it('routes .py files to Python validator', () => {
		const errors = validateSyntax('x = (', 'test.py');
		expect(errors.length).toBeGreaterThan(0);
	});

	it('returns empty for unknown extensions', () => {
		const errors = validateSyntax('anything here', 'test.txt');
		expect(errors).toEqual([]);
	});

	it('routes .js files to TypeScript validator', () => {
		const errors = validateSyntax('const a = {;', 'test.js');
		expect(errors.length).toBeGreaterThan(0);
	});
});
