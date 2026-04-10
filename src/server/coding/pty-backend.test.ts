import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PtyBackend } from './pty-backend';

const execFileAsync = promisify(execFile);

describe('PtyBackend', () => {
	let workDir: string;
	let backend: PtyBackend;

	beforeEach(async () => {
		workDir = await mkdtemp(join(tmpdir(), 'pty-backend-'));
		await execFileAsync('git', ['init'], { cwd: workDir });
		await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: workDir });
		await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: workDir });
		backend = new PtyBackend(workDir);
	});

	afterEach(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it('has type "pty"', () => {
		expect(backend.type).toBe('pty');
	});

	describe('open', () => {
		it('opens a file and shows contents with line numbers', async () => {
			await writeFile(join(workDir, 'test.ts'), 'line1\nline2\nline3\n');
			const result = await backend.open('test.ts');
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain('test.ts');
			expect(result.currentFile).toBe('test.ts');
		});

		it('returns error for missing file', async () => {
			const result = await backend.open('nonexistent.ts');
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain('File not found');
		});

		it('opens at specific line', async () => {
			const lines = Array.from({ length: 200 }, (_, i) => `content ${i + 1}`).join('\n');
			await writeFile(join(workDir, 'big.ts'), lines);
			const result = await backend.open('big.ts', 150);
			expect(result.exitCode).toBe(0);
			expect(result.currentLine).toBe(150);
		});

		it('rejects path traversal', async () => {
			await expect(backend.open('../../../etc/passwd')).rejects.toThrow('Path traversal');
		});
	});

	describe('edit', () => {
		it('requires an open file', async () => {
			const result = await backend.edit(1, 1, 'new');
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain('No file');
		});

		it('replaces lines correctly', async () => {
			await writeFile(join(workDir, 'edit.ts'), 'a\nb\nc\nd\n');
			await backend.open('edit.ts');
			const result = await backend.edit(2, 3, 'X\nY');
			expect(result.exitCode).toBe(0);
			const content = await readFile(join(workDir, 'edit.ts'), 'utf-8');
			expect(content).toBe('a\nX\nY\nd\n');
		});

		it('rejects invalid line range', async () => {
			await writeFile(join(workDir, 'small.ts'), 'one\ntwo\n');
			await backend.open('small.ts');
			const result = await backend.edit(1, 10, 'nope');
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain('Invalid line range');
		});
	});

	describe('searchFile', () => {
		it('finds matches via grep', async () => {
			await writeFile(join(workDir, 'grep.ts'), 'alpha\nbeta\nalpha gamma\n');
			await backend.open('grep.ts');
			const result = await backend.searchFile('alpha');
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain('2 match(es)');
		});

		it('returns not found for no matches', async () => {
			await writeFile(join(workDir, 'no.ts'), 'nothing here\n');
			await backend.open('no.ts');
			const result = await backend.searchFile('zzz');
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain('No matches');
		});

		it('requires a file', async () => {
			const result = await backend.searchFile('test');
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain('No file');
		});
	});

	describe('submit', () => {
		it('commits staged changes', async () => {
			await writeFile(join(workDir, 'file.ts'), 'init\n');
			await execFileAsync('git', ['add', '-A'], { cwd: workDir });
			await execFileAsync('git', ['commit', '-m', 'init'], { cwd: workDir });

			await writeFile(join(workDir, 'file.ts'), 'updated\n');
			const result = await backend.submit('test change');
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain('committed');
		});

		it('handles no changes', async () => {
			await writeFile(join(workDir, 'file.ts'), 'init\n');
			await execFileAsync('git', ['add', '-A'], { cwd: workDir });
			await execFileAsync('git', ['commit', '-m', 'init'], { cwd: workDir });

			const result = await backend.submit('no-op');
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain('No changes');
		});
	});

	describe('scroll', () => {
		it('requires an open file', async () => {
			const result = await backend.scroll('down');
			expect(result.exitCode).toBe(1);
		});

		it('scrolls down', async () => {
			const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
			await writeFile(join(workDir, 'scroll.ts'), lines);
			await backend.open('scroll.ts');
			const result = await backend.scroll('down', 50);
			expect(result.exitCode).toBe(0);
		});
	});

	describe('gotoLine', () => {
		it('requires an open file', async () => {
			const result = await backend.gotoLine(5);
			expect(result.exitCode).toBe(1);
		});

		it('jumps to a line', async () => {
			const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
			await writeFile(join(workDir, 'jump.ts'), lines);
			await backend.open('jump.ts');
			const result = await backend.gotoLine(30);
			expect(result.exitCode).toBe(0);
		});
	});
});
