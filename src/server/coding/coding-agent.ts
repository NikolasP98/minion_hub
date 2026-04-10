import { resolve } from 'node:path';
import type { CodingBackend, CodingBackendType, CodingAgentConfig, CodingResult } from './types';
import { ACIBackend } from './aci-backend';
import { PtyBackend } from './pty-backend';

/**
 * Resolves which coding backend to use.
 * Priority: explicit config > CODING_BACKEND env var > 'pty' default
 */
export function resolveCodingBackendType(config?: CodingAgentConfig): CodingBackendType {
	if (config?.codingBackend) return config.codingBackend;
	const envBackend = process.env.CODING_BACKEND;
	if (envBackend === 'aci' || envBackend === 'pty') return envBackend;
	return 'pty';
}

/**
 * Creates a CodingBackend instance based on the resolved backend type.
 */
export function createCodingBackend(config: CodingAgentConfig): CodingBackend {
	const backendType = resolveCodingBackendType(config);
	const workDir = resolve(config.workDir);

	if (backendType === 'aci') {
		return new ACIBackend(workDir, { windowSize: config.windowSize });
	}

	return new PtyBackend(workDir, config.shell);
}

/**
 * CodingAgent orchestrates coding tasks through a pluggable backend.
 * Wraps the selected CodingBackend with task-level operations.
 */
export class CodingAgent {
	private backend: CodingBackend;
	private workDir: string;

	constructor(config: CodingAgentConfig) {
		this.workDir = resolve(config.workDir);
		this.backend = createCodingBackend(config);
	}

	get backendType(): CodingBackendType {
		return this.backend.type;
	}

	/**
	 * Execute a refactor task: open a file, apply edits, and submit.
	 */
	async executeRefactor(task: {
		file: string;
		startLine: number;
		endLine: number;
		newContent: string;
		commitMsg?: string;
	}): Promise<{ steps: CodingResult[]; success: boolean }> {
		const steps: CodingResult[] = [];

		const openResult = await this.backend.open(task.file);
		steps.push(openResult);
		if (openResult.exitCode !== 0) {
			return { steps, success: false };
		}

		const editResult = await this.backend.edit(task.startLine, task.endLine, task.newContent);
		steps.push(editResult);
		if (editResult.exitCode !== 0) {
			return { steps, success: false };
		}

		if (editResult.lintErrors && editResult.lintErrors.length > 0) {
			const errorCount = editResult.lintErrors.filter(e => e.severity === 'error').length;
			if (errorCount > 0) {
				return { steps, success: false };
			}
		}

		const submitResult = await this.backend.submit(task.commitMsg);
		steps.push(submitResult);

		return { steps, success: submitResult.exitCode === 0 };
	}

	/**
	 * Execute a search task across one or more files.
	 */
	async executeSearch(task: {
		regex: string;
		file?: string;
	}): Promise<CodingResult> {
		if (task.file) {
			await this.backend.open(task.file);
		}
		return this.backend.searchFile(task.regex, task.file);
	}

	/** Delegate directly to backend */
	open(file: string, line?: number): Promise<CodingResult> {
		return this.backend.open(file, line);
	}

	edit(startLine: number, endLine: number, newContent: string): Promise<CodingResult> {
		return this.backend.edit(startLine, endLine, newContent);
	}

	searchFile(regex: string, file?: string): Promise<CodingResult> {
		return this.backend.searchFile(regex, file);
	}

	submit(commitMsg?: string): Promise<CodingResult> {
		return this.backend.submit(commitMsg);
	}

	scroll(direction: 'up' | 'down', lines?: number): Promise<CodingResult> {
		return this.backend.scroll(direction, lines);
	}

	gotoLine(line: number): Promise<CodingResult> {
		return this.backend.gotoLine(line);
	}
}
