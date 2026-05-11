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
