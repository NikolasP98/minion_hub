import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CodingBackend, CodingResult } from './types';

const execFileAsync = promisify(execFile);

/**
 * PTY-based coding backend that delegates file operations to shell commands.
 * This is the traditional/default backend — commands run through the shell
 * rather than through structured file manipulation APIs.
 */
export class PtyBackend implements CodingBackend {
	readonly type = 'pty' as const;
	private workDir: string;
	private shell: string;
	private currentFile: string | null = null;
	private currentLine = 1;

	constructor(workDir: string, shell?: string) {
		this.workDir = resolve(workDir);
		this.shell = shell ?? '/bin/bash';
	}

	private resolvePath(file: string): string {
		const resolved = resolve(this.workDir, file);
		if (!resolved.startsWith(this.workDir)) {
			throw new Error(`Path traversal detected: ${file}`);
		}
		return resolved;
	}

	private async exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		try {
			const { stdout, stderr } = await execFileAsync(this.shell, ['-c', command], {
				cwd: this.workDir,
				timeout: 30_000,
			});
			return { stdout, stderr, exitCode: 0 };
		} catch (err: unknown) {
			const execErr = err as { stdout?: string; stderr?: string; code?: number };
			return {
				stdout: execErr.stdout ?? '',
				stderr: execErr.stderr ?? String(err),
				exitCode: execErr.code ?? 1,
			};
		}
	}

	async open(file: string, line?: number): Promise<CodingResult> {
		const absPath = this.resolvePath(file);
		try {
			await access(absPath);
		} catch {
			return { output: `File not found: ${file}`, exitCode: 1 };
		}

		const targetLine = line ?? 1;
		const startLine = Math.max(1, targetLine);
		const endLine = startLine + 99;

		const { stdout, exitCode } = await this.exec(
			`cat -n "${absPath}" | sed -n '${startLine},${endLine}p'`
		);

		if (exitCode !== 0) {
			return { output: `Error opening file: ${file}`, exitCode };
		}

		this.currentFile = file;
		this.currentLine = targetLine;

		const totalLines = await this.exec(`wc -l < "${absPath}"`);
		const total = parseInt(totalLines.stdout.trim(), 10) || 0;
		const header = `[File: ${file} (${total} lines total)]`;

		return {
			output: `${header}\n${stdout}`,
			exitCode: 0,
			currentFile: file,
			currentLine: this.currentLine,
		};
	}

	async edit(startLine: number, endLine: number, newContent: string): Promise<CodingResult> {
		if (!this.currentFile) {
			return { output: 'No file is currently open. Use open() first.', exitCode: 1 };
		}

		const absPath = this.resolvePath(this.currentFile);

		try {
			const content = await readFile(absPath, 'utf-8');
			const lines = content.split('\n');

			if (startLine < 1 || endLine < startLine || endLine > lines.length) {
				return {
					output: `Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)`,
					exitCode: 1,
					currentFile: this.currentFile,
					currentLine: this.currentLine,
				};
			}

			const newLines = newContent.split('\n');
			const before = lines.slice(0, startLine - 1);
			const after = lines.slice(endLine);
			const updated = [...before, ...newLines, ...after];

			await writeFile(absPath, updated.join('\n'), 'utf-8');
			this.currentLine = startLine;

			const diffInfo = `[${endLine - startLine + 1} line(s) replaced with ${newLines.length} line(s)]`;

			return {
				output: diffInfo,
				exitCode: 0,
				currentFile: this.currentFile,
				currentLine: this.currentLine,
			};
		} catch (err) {
			return {
				output: `Error editing file: ${err instanceof Error ? err.message : String(err)}`,
				exitCode: 1,
				currentFile: this.currentFile,
				currentLine: this.currentLine,
			};
		}
	}

	async searchFile(regex: string, file?: string): Promise<CodingResult> {
		const targetFile = file ?? this.currentFile;
		if (!targetFile) {
			return { output: 'No file specified and no file is currently open.', exitCode: 1 };
		}

		const absPath = this.resolvePath(targetFile);
		const { stdout, exitCode } = await this.exec(`grep -n -E "${regex.replace(/"/g, '\\"')}" "${absPath}"`);

		if (exitCode !== 0 || !stdout.trim()) {
			return {
				output: `No matches found for pattern: ${regex}`,
				exitCode: 1,
				currentFile: this.currentFile ?? undefined,
				currentLine: this.currentLine,
			};
		}

		const lines = stdout.trim().split('\n');
		const output = [
			`[Search results for '${regex}' in ${targetFile}: ${lines.length} match(es)]`,
			...lines,
		].join('\n');

		return {
			output,
			exitCode: 0,
			currentFile: this.currentFile ?? undefined,
			currentLine: this.currentLine,
		};
	}

	async submit(commitMsg?: string): Promise<CodingResult> {
		const message = commitMsg ?? 'PTY: apply changes';

		const addResult = await this.exec('git add -A');
		if (addResult.exitCode !== 0) {
			return { output: `Error staging: ${addResult.stderr}`, exitCode: 1 };
		}

		const statusResult = await this.exec('git status --porcelain');
		if (!statusResult.stdout.trim()) {
			return {
				output: 'No changes to commit.',
				exitCode: 0,
				currentFile: this.currentFile ?? undefined,
				currentLine: this.currentLine,
			};
		}

		const commitResult = await this.exec(`git commit -m "${message.replace(/"/g, '\\"')}"`);

		return {
			output: commitResult.exitCode === 0
				? `Changes committed:\n${commitResult.stdout.trim()}`
				: `Error committing: ${commitResult.stderr}`,
			exitCode: commitResult.exitCode,
			currentFile: this.currentFile ?? undefined,
			currentLine: this.currentLine,
		};
	}

	async scroll(direction: 'up' | 'down', lines?: number): Promise<CodingResult> {
		if (!this.currentFile) {
			return { output: 'No file is currently open. Use open() first.', exitCode: 1 };
		}

		const scrollAmount = lines ?? 100;

		if (direction === 'down') {
			this.currentLine += scrollAmount;
		} else {
			this.currentLine = Math.max(1, this.currentLine - scrollAmount);
		}

		return this.open(this.currentFile, this.currentLine);
	}

	async gotoLine(line: number): Promise<CodingResult> {
		if (!this.currentFile) {
			return { output: 'No file is currently open. Use open() first.', exitCode: 1 };
		}

		this.currentLine = line;
		return this.open(this.currentFile, line);
	}
}
