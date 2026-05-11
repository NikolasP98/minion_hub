import { readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative } from 'node:path';
import type { ACIResult, ACIBackendConfig } from './types';
import { validateSyntax } from './syntax-validator';

const execFileAsync = promisify(execFile);

const DEFAULT_WINDOW_SIZE = 100;

export class ACIBackend {
  private workDir: string;
  private windowSize: number;
  private currentFile: string | null = null;
  private currentLine = 1;
  private fileContents: Map<string, string[]> = new Map();

  constructor(workDir: string, config?: ACIBackendConfig) {
    this.workDir = resolve(workDir);
    this.windowSize = config?.windowSize ?? DEFAULT_WINDOW_SIZE;
  }

  private resolvePath(file: string): string {
    const resolved = resolve(this.workDir, file);
    if (!resolved.startsWith(this.workDir)) {
      throw new Error(`Path traversal detected: ${file}`);
    }
    return resolved;
  }

  private async loadFile(file: string): Promise<string[]> {
    const absPath = this.resolvePath(file);
    const content = await readFile(absPath, 'utf-8');
    const lines = content.split('\n');
    this.fileContents.set(file, lines);
    return lines;
  }

  private formatWindow(lines: string[], startLine: number, file: string): string {
    const output: string[] = [];
    output.push(`[File: ${file} (${lines.length} lines total)]`);

    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, start + this.windowSize);

    for (let i = start; i < end; i++) {
      const lineNum = String(i + 1).padStart(String(lines.length).length, ' ');
      output.push(`${lineNum}|${lines[i]}`);
    }

    if (end < lines.length) {
      output.push(`(${lines.length - end} more lines below)`);
    }
    if (start > 0) {
      output.unshift(`(${start} more lines above)`);
    }

    return output.join('\n');
  }

  async open(file: string, line?: number): Promise<ACIResult> {
    try {
      const absPath = this.resolvePath(file);
      await access(absPath);
    } catch {
      return {
        output: `File not found: ${file}`,
        exitCode: 1,
      };
    }

    try {
      const lines = await this.loadFile(file);
      const targetLine = line ?? 1;

      if (targetLine < 1 || targetLine > lines.length) {
        return {
          output: `Line ${targetLine} is out of range (file has ${lines.length} lines)`,
          exitCode: 1,
          currentFile: file,
          currentLine: this.currentLine,
        };
      }

      this.currentFile = file;
      this.currentLine = targetLine;

      return {
        output: this.formatWindow(lines, targetLine, file),
        exitCode: 0,
        currentFile: this.currentFile,
        currentLine: this.currentLine,
      };
    } catch (err) {
      return {
        output: `Error opening file: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
      };
    }
  }

  async edit(startLine: number, endLine: number, newContent: string): Promise<ACIResult> {
    if (!this.currentFile) {
      return { output: 'No file is currently open. Use open() first.', exitCode: 1 };
    }

    const file = this.currentFile;

    try {
      let lines = this.fileContents.get(file);
      if (!lines) {
        lines = await this.loadFile(file);
      }

      if (startLine < 1 || endLine < startLine || endLine > lines.length) {
        return {
          output: `Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)`,
          exitCode: 1,
          currentFile: file,
          currentLine: this.currentLine,
        };
      }

      const newLines = newContent.split('\n');
      const before = lines.slice(0, startLine - 1);
      const after = lines.slice(endLine);
      const updated = [...before, ...newLines, ...after];

      const updatedContent = updated.join('\n');
      const absPath = this.resolvePath(file);
      await writeFile(absPath, updatedContent, 'utf-8');

      this.fileContents.set(file, updated);
      this.currentLine = startLine;

      const lintErrors = validateSyntax(updatedContent, file);

      const diffInfo = `[${endLine - startLine + 1} line(s) replaced with ${newLines.length} line(s)]`;
      const output = [diffInfo, this.formatWindow(updated, startLine, file)].join('\n');

      return {
        output,
        exitCode: 0,
        currentFile: file,
        currentLine: this.currentLine,
        lintErrors: lintErrors.length > 0 ? lintErrors : undefined,
      };
    } catch (err) {
      return {
        output: `Error editing file: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
        currentFile: file,
        currentLine: this.currentLine,
      };
    }
  }

  async searchFile(regex: string, file?: string): Promise<ACIResult> {
    const targetFile = file ?? this.currentFile;
    if (!targetFile) {
      return { output: 'No file specified and no file is currently open.', exitCode: 1 };
    }

    try {
      let lines = this.fileContents.get(targetFile);
      if (!lines) {
        lines = await this.loadFile(targetFile);
      }

      let pattern: RegExp;
      try {
        pattern = new RegExp(regex, 'g');
      } catch {
        return {
          output: `Invalid regex: ${regex}`,
          exitCode: 1,
          currentFile: this.currentFile ?? undefined,
          currentLine: this.currentLine,
        };
      }

      const matches: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          const lineNum = String(i + 1).padStart(String(lines.length).length, ' ');
          matches.push(`${lineNum}|${lines[i]}`);
        }
        pattern.lastIndex = 0;
      }

      if (matches.length === 0) {
        return {
          output: `No matches found for pattern: ${regex}`,
          exitCode: 1,
          currentFile: this.currentFile ?? undefined,
          currentLine: this.currentLine,
        };
      }

      const output = [
        `[Search results for '${regex}' in ${targetFile}: ${matches.length} match(es)]`,
        ...matches,
      ].join('\n');

      return {
        output,
        exitCode: 0,
        currentFile: this.currentFile ?? undefined,
        currentLine: this.currentLine,
      };
    } catch (err) {
      return {
        output: `Error searching file: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
        currentFile: this.currentFile ?? undefined,
        currentLine: this.currentLine,
      };
    }
  }

  async submit(commitMsg?: string): Promise<ACIResult> {
    const message = commitMsg ?? 'ACI: apply changes';

    try {
      await execFileAsync('git', ['add', '-A'], { cwd: this.workDir });

      const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: this.workDir,
      });
      if (!statusOut.trim()) {
        return {
          output: 'No changes to commit.',
          exitCode: 0,
          currentFile: this.currentFile ?? undefined,
          currentLine: this.currentLine,
        };
      }

      const { stdout: commitOut } = await execFileAsync('git', ['commit', '-m', message], {
        cwd: this.workDir,
      });

      this.fileContents.clear();

      return {
        output: `Changes committed:\n${commitOut.trim()}`,
        exitCode: 0,
        currentFile: this.currentFile ?? undefined,
        currentLine: this.currentLine,
      };
    } catch (err) {
      return {
        output: `Error committing: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
        currentFile: this.currentFile ?? undefined,
        currentLine: this.currentLine,
      };
    }
  }

  async scroll(direction: 'up' | 'down', lines?: number): Promise<ACIResult> {
    if (!this.currentFile) {
      return { output: 'No file is currently open. Use open() first.', exitCode: 1 };
    }

    const file = this.currentFile;
    let fileLines = this.fileContents.get(file);
    if (!fileLines) {
      fileLines = await this.loadFile(file);
    }

    const scrollAmount = lines ?? this.windowSize;

    if (direction === 'down') {
      this.currentLine = Math.min(this.currentLine + scrollAmount, fileLines.length);
    } else {
      this.currentLine = Math.max(this.currentLine - scrollAmount, 1);
    }

    return {
      output: this.formatWindow(fileLines, this.currentLine, file),
      exitCode: 0,
      currentFile: this.currentFile,
      currentLine: this.currentLine,
    };
  }

  async gotoLine(line: number): Promise<ACIResult> {
    if (!this.currentFile) {
      return { output: 'No file is currently open. Use open() first.', exitCode: 1 };
    }

    const file = this.currentFile;
    let fileLines = this.fileContents.get(file);
    if (!fileLines) {
      fileLines = await this.loadFile(file);
    }

    if (line < 1 || line > fileLines.length) {
      return {
        output: `Line ${line} is out of range (file has ${fileLines.length} lines)`,
        exitCode: 1,
        currentFile: file,
        currentLine: this.currentLine,
      };
    }

    this.currentLine = line;

    return {
      output: this.formatWindow(fileLines, line, file),
      exitCode: 0,
      currentFile: file,
      currentLine: this.currentLine,
    };
  }
}
