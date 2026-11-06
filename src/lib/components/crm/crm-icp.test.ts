import { describe, expect, it } from 'vitest';
import {
	ICP_CLAIM_KEY,
	ICP_KEY,
	icpDefinitionSchema,
	icpDefinitionWriteSchema,
	icpResultSchema,
	isIcpConfigured,
	maskIcpResult,
	parseIcpResult,
	type IcpDefinition,
} from './crm-icp';

const NOW = '2026-11-06T08:00:00.000Z';

const criterion = (i: number, over: Record<string, unknown> = {}) => ({
	id: `c${i}`,
	label: `Criterion ${i}`,
	weight: 3,
	...over,
});

const validWrite = (over: Record<string, unknown> = {}) => ({
	description: 'Mid-size clinics that book online',
	criteria: [criterion(1)],
	disqualifiers: ['Competitor'],
	...over,
});

const validResult = (over: Record<string, unknown> = {}) => ({
	score: 72,
	band: 'moderate',
	criteria: [{ id: 'c1', met: true, note: 'books online' }],
	reasons: ['fits size'],
	evidenceRefs: [{ chunkId: 'chunk-1' }],
	inputSig: 'sig-abc',
	icpVersion: 2,
	model: 'm-1',
	promptVersion: 1,
	scoredAt: NOW,
	...over,
});

describe('keys', () => {
	it('exposes the fixed key names', () => {
		expect(ICP_KEY).toBe('_icp');
		expect(ICP_CLAIM_KEY).toBe('_icpClaim');
	});
});

describe('icpDefinitionWriteSchema', () => {
	it('accepts a maximal valid definition and trims strings', () => {
		const out = icpDefinitionWriteSchema.parse({
			description: '  padded  ',
			criteria: Array.from({ length: 8 }, (_, i) => criterion(i + 1, { label: '  L  ' })),
			disqualifiers: Array.from({ length: 5 }, (_, i) => `  d${i}  `),
		});
		expect(out.description).toBe('padded');
		expect(out.criteria).toHaveLength(8);
		expect(out.criteria[0].label).toBe('L');
		expect(out.disqualifiers[0]).toBe('d0');
	});

	it('accepts an empty description and empty lists', () => {
		expect(
			icpDefinitionWriteSchema.safeParse({ description: '', criteria: [], disqualifiers: [] }).success,
		).toBe(true);
	});

	const rejects: Array<[string, Record<string, unknown>]> = [
		['9 criteria', { criteria: Array.from({ length: 9 }, (_, i) => criterion(i + 1)) }],
		['6 disqualifiers', { disqualifiers: ['a', 'b', 'c', 'd', 'e', 'f'] }],
		['2001-char description', { description: 'x'.repeat(2001) }],
		['weight 0', { criteria: [criterion(1, { weight: 0 })] }],
		['weight 6', { criteria: [criterion(1, { weight: 6 })] }],
		['weight 2.5', { criteria: [criterion(1, { weight: 2.5 })] }],
		['duplicate criterion ids', { criteria: [criterion(1), criterion(1, { label: 'Other' })] }],
		['non-slug id', { criteria: [criterion(1, { id: 'Not A Slug' })] }],
		['41-char id', { criteria: [criterion(1, { id: 'a'.repeat(41) })] }],
		['empty label', { criteria: [criterion(1, { label: '   ' })] }],
		['empty disqualifier', { disqualifiers: ['  '] }],
		['unknown top-level key', { extra: true }],
		['unknown criterion key', { criteria: [criterion(1, { extra: 1 })] }],
		['client-supplied version', { version: 1 }],
		['client-supplied updatedAt', { updatedAt: NOW }],
	];
	it.each(rejects)('rejects %s', (_name, over) => {
		expect(icpDefinitionWriteSchema.safeParse(validWrite(over)).success).toBe(false);
	});
});

describe('icpDefinitionSchema (stored)', () => {
	const stored = (over: Record<string, unknown> = {}) => ({
		...validWrite(),
		version: 1,
		updatedAt: NOW,
		...over,
	});

	it('accepts version + ISO updatedAt', () => {
		expect(icpDefinitionSchema.safeParse(stored()).success).toBe(true);
	});

	it.each([0, -1, 1.5, '1'])('rejects version %j', (version) => {
		expect(icpDefinitionSchema.safeParse(stored({ version })).success).toBe(false);
	});

	it('requires version and updatedAt', () => {
		expect(icpDefinitionSchema.safeParse(validWrite()).success).toBe(false);
	});

	it('rejects a non-ISO updatedAt', () => {
		expect(icpDefinitionSchema.safeParse(stored({ updatedAt: 'yesterday' })).success).toBe(false);
	});
});

describe('isIcpConfigured', () => {
	const def = (over: Partial<IcpDefinition>): IcpDefinition => ({
		description: '',
		criteria: [],
		disqualifiers: [],
		version: 1,
		updatedAt: NOW,
		...over,
	});

	it('is false for null/undefined', () => {
		expect(isIcpConfigured(null)).toBe(false);
		expect(isIcpConfigured(undefined)).toBe(false);
	});
	it('is false for an empty description and no criteria', () => {
		expect(isIcpConfigured(def({}))).toBe(false);
		expect(isIcpConfigured(def({ description: '   ' }))).toBe(false);
	});
	it('is true with criteria only', () => {
		expect(
			isIcpConfigured(def({ criteria: [{ id: 'a', label: 'A', weight: 1 }] })),
		).toBe(true);
	});
	it('is true with a description only', () => {
		expect(isIcpConfigured(def({ description: 'Clinics' }))).toBe(true);
	});
});

describe('icpResultSchema', () => {
	it('accepts a valid result', () => {
		expect(icpResultSchema.safeParse(validResult()).success).toBe(true);
	});

	it.each([-1, 101, NaN])('rejects score %s', (score) => {
		expect(icpResultSchema.safeParse(validResult({ score })).success).toBe(false);
	});

	const rejects: Array<[string, Record<string, unknown>]> = [
		['a 141-char note', { criteria: [{ id: 'c1', met: true, note: 'n'.repeat(141) }] }],
		['4 reasons', { reasons: ['a', 'b', 'c', 'd'] }],
		['a 201-char reason', { reasons: ['r'.repeat(201)] }],
		['an evidenceRef carrying text', { evidenceRefs: [{ chunkId: 'c', text: 'leak' }] }],
		['an empty chunkId', { evidenceRefs: [{ chunkId: '' }] }],
		['an unknown key', { extra: 1 }],
		['an unknown band', { band: 'great' }],
		['a non-ISO scoredAt', { scoredAt: 'nope' }],
		['icpVersion 0', { icpVersion: 0 }],
		['empty inputSig', { inputSig: '' }],
		['disqualified with score 11', { band: 'disqualified', score: 11 }],
	];
	it.each(rejects)('rejects %s', (_name, over) => {
		expect(icpResultSchema.safeParse(validResult(over)).success).toBe(false);
	});

	it('accepts disqualified with score 10', () => {
		expect(icpResultSchema.safeParse(validResult({ band: 'disqualified', score: 10 })).success).toBe(
			true,
		);
	});

	it('parseIcpResult returns undefined on failure', () => {
		expect(parseIcpResult(validResult())).toBeDefined();
		expect(parseIcpResult({ score: 1 })).toBeUndefined();
		expect(parseIcpResult(null)).toBeUndefined();
	});
});

describe('maskIcpResult', () => {
	it('keeps exactly the whitelist', () => {
		const out = maskIcpResult(validResult());
		expect(out).toBeDefined();
		expect(Object.keys(out!).sort()).toEqual(
			['band', 'criteria', 'icpVersion', 'score', 'scoredAt'].sort(),
		);
		expect(out).toEqual({
			score: 72,
			band: 'moderate',
			criteria: [{ id: 'c1', met: true }],
			icpVersion: 2,
			scoredAt: NOW,
		});
	});

	it('drops notes from criteria', () => {
		const out = maskIcpResult(validResult())!;
		for (const c of out.criteria) expect(Object.keys(c).sort()).toEqual(['id', 'met']);
	});

	it('returns undefined for malformed input (fail closed)', () => {
		expect(maskIcpResult({ score: 50 })).toBeUndefined();
		expect(maskIcpResult(validResult({ score: 500 }))).toBeUndefined();
		expect(maskIcpResult('x')).toBeUndefined();
		expect(maskIcpResult(undefined)).toBeUndefined();
	});

	it('does not mutate its input', () => {
		const input = validResult();
		const snapshot = structuredClone(input);
		maskIcpResult(input);
		expect(input).toEqual(snapshot);
	});
});
