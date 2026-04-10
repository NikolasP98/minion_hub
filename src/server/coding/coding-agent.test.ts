import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CodingAgent, resolveCodingBackendType, createCodingBackend } from './coding-agent';

const execFileAsync = promisify(execFile);

describe('resolveCodingBackendType', () => {
	const originalEnv = process.env.CODING_BACKEND;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CODING_BACKEND;
		} else {
			process.env.CODING_BACKEND = originalEnv;
		}
	});

	it('returns "pty" by default', () => {
		delete process.env.CODING_BACKEND;
		expect(resolveCodingBackendType()).toBe('pty');
	});

	it('returns "aci" from env var', () => {
		process.env.CODING_BACKEND = 'aci';
		expect(resolveCodingBackendType()).toBe('aci');
	});

	it('returns "pty" from env var', () => {
		process.env.CODING_BACKEND = 'pty';
		expect(resolveCodingBackendType()).toBe('pty');
	});

	it('ignores invalid env var and defaults to pty', () => {
		process.env.CODING_BACKEND = 'invalid';
		expect(resolveCodingBackendType()).toBe('pty');
	});

	it('config overrides env var', () => {
		process.env.CODING_BACKEND = 'pty';
		expect(resolveCodingBackendType({ workDir: '/tmp', codingBackend: 'aci' })).toBe('aci');
	});

	it('explicit config pty overrides env aci', () => {
		process.env.CODING_BACKEND = 'aci';
		expect(resolveCodingBackendType({ workDir: '/tmp', codingBackend: 'pty' })).toBe('pty');
	});
});

describe('createCodingBackend', () => {
	it('creates ACIBackend when aci requested', () => {
		const backend = createCodingBackend({ workDir: '/tmp', codingBackend: 'aci' });
		expect(backend.type).toBe('aci');
	});

	it('creates PtyBackend when pty requested', () => {
		const backend = createCodingBackend({ workDir: '/tmp', codingBackend: 'pty' });
		expect(backend.type).toBe('pty');
	});
});

describe('CodingAgent with ACI backend', () => {
	let workDir: string;
	let agent: CodingAgent;

	beforeEach(async () => {
		workDir = await mkdtemp(join(tmpdir(), 'coding-agent-aci-'));
		await execFileAsync('git', ['init'], { cwd: workDir });
		await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: workDir });
		await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: workDir });
		agent = new CodingAgent({ workDir, codingBackend: 'aci' });
	});

	afterEach(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it('reports aci backend type', () => {
		expect(agent.backendType).toBe('aci');
	});

	it('opens a file', async () => {
		await writeFile(join(workDir, 'hello.ts'), 'const x = 1;\nconst y = 2;\n');
		const result = await agent.open('hello.ts');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('hello.ts');
		expect(result.output).toContain('const x = 1');
	});

	it('edits a file', async () => {
		await writeFile(join(workDir, 'edit.ts'), 'line1\nline2\nline3\n');
		await agent.open('edit.ts');
		const result = await agent.edit(2, 2, 'replaced');
		expect(result.exitCode).toBe(0);
		const content = await readFile(join(workDir, 'edit.ts'), 'utf-8');
		expect(content).toContain('replaced');
		expect(content).not.toContain('line2');
	});

	it('searches a file', async () => {
		await writeFile(join(workDir, 'search.ts'), 'foo bar\nbaz qux\nfoo baz\n');
		await agent.open('search.ts');
		const result = await agent.searchFile('foo');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('2 match(es)');
	});

	it('submits changes', async () => {
		await writeFile(join(workDir, 'commit.ts'), 'initial\n');
		await execFileAsync('git', ['add', '-A'], { cwd: workDir });
		await execFileAsync('git', ['commit', '-m', 'init'], { cwd: workDir });
		await writeFile(join(workDir, 'commit.ts'), 'updated\n');
		const result = await agent.submit('test commit');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('committed');
	});

	it('scrolls through a file', async () => {
		const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
		await writeFile(join(workDir, 'long.ts'), lines);
		await agent.open('long.ts');
		const result = await agent.scroll('down', 50);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('line 51');
	});

	it('goes to a specific line', async () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
		await writeFile(join(workDir, 'goto.ts'), lines);
		await agent.open('goto.ts');
		const result = await agent.gotoLine(25);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('line 25');
	});

	it('executes a full refactor task E2E', async () => {
		const content = [
			'function oldName() {',
			'  return 42;',
			'}',
			'',
			'export { oldName };',
		].join('\n');
		await writeFile(join(workDir, 'refactor.ts'), content);
		await execFileAsync('git', ['add', '-A'], { cwd: workDir });
		await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workDir });

		const result = await agent.executeRefactor({
			file: 'refactor.ts',
			startLine: 1,
			endLine: 5,
			newContent: 'function newName() {\n  return 84;\n}\n\nexport { newName };',
			commitMsg: 'refactor: rename oldName to newName',
		});

		expect(result.success).toBe(true);
		expect(result.steps).toHaveLength(3);
		expect(result.steps[0].exitCode).toBe(0); // open
		expect(result.steps[1].exitCode).toBe(0); // edit
		expect(result.steps[2].exitCode).toBe(0); // submit

		const updated = await readFile(join(workDir, 'refactor.ts'), 'utf-8');
		expect(updated).toContain('newName');
		expect(updated).not.toContain('oldName');
		expect(updated).toContain('return 84');
	});
});

describe('CodingAgent with PTY backend', () => {
	let workDir: string;
	let agent: CodingAgent;

	beforeEach(async () => {
		workDir = await mkdtemp(join(tmpdir(), 'coding-agent-pty-'));
		await execFileAsync('git', ['init'], { cwd: workDir });
		await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: workDir });
		await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: workDir });
		agent = new CodingAgent({ workDir, codingBackend: 'pty' });
	});

	afterEach(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it('reports pty backend type', () => {
		expect(agent.backendType).toBe('pty');
	});

	it('opens a file', async () => {
		await writeFile(join(workDir, 'hello.ts'), 'const x = 1;\nconst y = 2;\n');
		const result = await agent.open('hello.ts');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('hello.ts');
	});

	it('edits a file', async () => {
		await writeFile(join(workDir, 'edit.ts'), 'line1\nline2\nline3\n');
		await agent.open('edit.ts');
		const result = await agent.edit(2, 2, 'replaced');
		expect(result.exitCode).toBe(0);
		const content = await readFile(join(workDir, 'edit.ts'), 'utf-8');
		expect(content).toContain('replaced');
		expect(content).not.toContain('line2');
	});

	it('searches a file', async () => {
		await writeFile(join(workDir, 'search.ts'), 'foo bar\nbaz qux\nfoo baz\n');
		await agent.open('search.ts');
		const result = await agent.searchFile('foo');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('match');
	});

	it('submits changes', async () => {
		await writeFile(join(workDir, 'commit.ts'), 'initial\n');
		await execFileAsync('git', ['add', '-A'], { cwd: workDir });
		await execFileAsync('git', ['commit', '-m', 'init'], { cwd: workDir });
		await writeFile(join(workDir, 'commit.ts'), 'updated\n');
		const result = await agent.submit('test commit');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('committed');
	});

	it('scrolls through a file', async () => {
		const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
		await writeFile(join(workDir, 'long.ts'), lines);
		await agent.open('long.ts');
		const result = await agent.scroll('down', 50);
		expect(result.exitCode).toBe(0);
	});

	it('goes to a specific line', async () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
		await writeFile(join(workDir, 'goto.ts'), lines);
		await agent.open('goto.ts');
		const result = await agent.gotoLine(25);
		expect(result.exitCode).toBe(0);
	});

	it('handles refactor E2E with PTY', async () => {
		const content = [
			'function oldFunc() {',
			'  return "old";',
			'}',
		].join('\n');
		await writeFile(join(workDir, 'refactor.ts'), content);
		await execFileAsync('git', ['add', '-A'], { cwd: workDir });
		await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workDir });

		const result = await agent.executeRefactor({
			file: 'refactor.ts',
			startLine: 1,
			endLine: 3,
			newContent: 'function newFunc() {\n  return "new";\n}',
			commitMsg: 'refactor: rename function',
		});

		expect(result.success).toBe(true);
		const updated = await readFile(join(workDir, 'refactor.ts'), 'utf-8');
		expect(updated).toContain('newFunc');
		expect(updated).not.toContain('oldFunc');
	});
});

describe('CodingAgent backend selection E2E', () => {
	const originalEnv = process.env.CODING_BACKEND;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CODING_BACKEND;
		} else {
			process.env.CODING_BACKEND = originalEnv;
		}
	});

	it('defaults to PTY when no config or env', () => {
		delete process.env.CODING_BACKEND;
		const agent = new CodingAgent({ workDir: '/tmp' });
		expect(agent.backendType).toBe('pty');
	});

	it('selects ACI from env var', () => {
		process.env.CODING_BACKEND = 'aci';
		const agent = new CodingAgent({ workDir: '/tmp' });
		expect(agent.backendType).toBe('aci');
	});

	it('config overrides env', () => {
		process.env.CODING_BACKEND = 'pty';
		const agent = new CodingAgent({ workDir: '/tmp', codingBackend: 'aci' });
		expect(agent.backendType).toBe('aci');
	});
});
