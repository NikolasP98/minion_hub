export interface LintError {
	file: string;
	line: number;
	column: number;
	message: string;
	severity: 'error' | 'warning';
}

export interface ACIResult {
	output: string;
	exitCode: number;
	currentFile?: string;
	currentLine?: number;
	lintErrors?: LintError[];
}

export interface ACIBackendConfig {
	windowSize?: number;
}

/** Unified result for all coding backend operations */
export interface CodingResult {
	output: string;
	exitCode: number;
	currentFile?: string;
	currentLine?: number;
	lintErrors?: LintError[];
}

/** Common interface for coding backends (ACI, PTY) */
export interface CodingBackend {
	readonly type: 'aci' | 'pty';
	open(file: string, line?: number): Promise<CodingResult>;
	edit(startLine: number, endLine: number, newContent: string): Promise<CodingResult>;
	searchFile(regex: string, file?: string): Promise<CodingResult>;
	submit(commitMsg?: string): Promise<CodingResult>;
	scroll(direction: 'up' | 'down', lines?: number): Promise<CodingResult>;
	gotoLine(line: number): Promise<CodingResult>;
}

export type CodingBackendType = 'aci' | 'pty';

export interface CodingAgentConfig {
	workDir: string;
	codingBackend?: CodingBackendType;
	windowSize?: number;
	shell?: string;
}
