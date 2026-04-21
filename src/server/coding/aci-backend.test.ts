import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ACIBackend } from './aci-backend';

const execFileAsync = promisify(execFile);

let workDir: string;
let backend: ACIBackend;

async function initGitRepo(dir: string) {
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'aci-test-'));
  await initGitRepo(workDir);
  backend = new ACIBackend(workDir, { windowSize: 10 });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function createTestFile(name: string, content: string) {
  return writeFile(join(workDir, name), content, 'utf-8');
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('ACIBackend', () => {
  describe('open', () => {
    it('opens a file and shows line-numbered content', async () => {
      await createTestFile('hello.ts', 'const a = 1;\nconst b = 2;\nconst c = 3;');
      const result = await backend.open('hello.ts');

      expect(result.exitCode).toBe(0);
      expect(result.currentFile).toBe('hello.ts');
      expect(result.currentLine).toBe(1);
      expect(result.output).toContain('[File: hello.ts (3 lines total)]');
      expect(result.output).toContain('1|const a = 1;');
      expect(result.output).toContain('2|const b = 2;');
      expect(result.output).toContain('3|const c = 3;');
    });

    it('opens a file at a specific line', async () => {
      await createTestFile('big.ts', numberedLines(30));
      const result = await backend.open('big.ts', 15);

      expect(result.exitCode).toBe(0);
      expect(result.currentLine).toBe(15);
      expect(result.output).toContain('15|line 15');
      expect(result.output).toContain('(14 more lines above)');
    });

    it('returns error for non-existent file', async () => {
      const result = await backend.open('nope.ts');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('File not found');
    });

    it('returns error for out-of-range line', async () => {
      await createTestFile('small.ts', 'one\ntwo');
      const result = await backend.open('small.ts', 99);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('out of range');
    });

    it('rejects path traversal', async () => {
      const result = await backend.open('../../../etc/passwd');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('edit', () => {
    it('replaces a line range with new content', async () => {
      await createTestFile('edit.ts', 'line 1\nline 2\nline 3\nline 4');
      await backend.open('edit.ts');

      const result = await backend.edit(2, 3, 'replaced A\nreplaced B');

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('2 line(s) replaced with 2 line(s)');

      const content = await readFile(join(workDir, 'edit.ts'), 'utf-8');
      expect(content).toBe('line 1\nreplaced A\nreplaced B\nline 4');
    });

    it('returns error when no file is open', async () => {
      const result = await backend.edit(1, 1, 'test');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('No file is currently open');
    });

    it('returns error for invalid line range', async () => {
      await createTestFile('edit2.ts', 'a\nb\nc');
      await backend.open('edit2.ts');

      const result = await backend.edit(3, 1, 'test');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Invalid line range');
    });

    it('returns error for out-of-bounds range', async () => {
      await createTestFile('edit3.ts', 'a\nb');
      await backend.open('edit3.ts');

      const result = await backend.edit(1, 5, 'test');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Invalid line range');
    });

    it('returns lint errors for TypeScript syntax issues', async () => {
      await createTestFile('bad.ts', 'const a = 1;');
      await backend.open('bad.ts');

      const result = await backend.edit(1, 1, 'const a = {;');

      expect(result.exitCode).toBe(0);
      expect(result.lintErrors).toBeDefined();
      expect(result.lintErrors!.length).toBeGreaterThan(0);
      expect(result.lintErrors![0].severity).toBe('error');
    });

    it('does not return lint errors for valid TypeScript', async () => {
      await createTestFile('good.ts', 'const a = 1;');
      await backend.open('good.ts');

      const result = await backend.edit(1, 1, 'const b = 2;');

      expect(result.exitCode).toBe(0);
      expect(result.lintErrors).toBeUndefined();
    });
  });

  describe('searchFile', () => {
    it('finds matching lines with line numbers', async () => {
      await createTestFile('search.ts', 'foo bar\nbaz\nfoo baz\nqux');
      await backend.open('search.ts');

      const result = await backend.searchFile('foo');

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('2 match(es)');
      expect(result.output).toContain('1|foo bar');
      expect(result.output).toContain('3|foo baz');
    });

    it('returns error when no matches found', async () => {
      await createTestFile('search2.ts', 'hello world');
      await backend.open('search2.ts');

      const result = await backend.searchFile('xyz');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('No matches found');
    });

    it('searches a specific file without opening it', async () => {
      await createTestFile('other.ts', 'target line\nnope');

      const result = await backend.searchFile('target', 'other.ts');
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('target line');
    });

    it('returns error for invalid regex', async () => {
      await createTestFile('r.ts', 'test');
      await backend.open('r.ts');

      const result = await backend.searchFile('[invalid');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Invalid regex');
    });

    it('returns error when no file specified and none open', async () => {
      const result = await backend.searchFile('test');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('No file specified');
    });
  });

  describe('submit', () => {
    it('commits all changes', async () => {
      await createTestFile('commit.ts', 'initial');
      await execFileAsync('git', ['add', '-A'], { cwd: workDir });
      await execFileAsync('git', ['commit', '-m', 'init'], { cwd: workDir });

      await writeFile(join(workDir, 'commit.ts'), 'modified', 'utf-8');

      const result = await backend.submit('test commit');

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Changes committed');

      const { stdout } = await execFileAsync('git', ['log', '--oneline', '-1'], { cwd: workDir });
      expect(stdout).toContain('test commit');
    });

    it('reports no changes when working tree is clean', async () => {
      await createTestFile('clean.ts', 'clean');
      await execFileAsync('git', ['add', '-A'], { cwd: workDir });
      await execFileAsync('git', ['commit', '-m', 'init'], { cwd: workDir });

      const result = await backend.submit();
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('No changes');
    });
  });

  describe('scroll', () => {
    it('scrolls down in the current file', async () => {
      await createTestFile('scroll.ts', numberedLines(30));
      await backend.open('scroll.ts');

      const result = await backend.scroll('down');

      expect(result.exitCode).toBe(0);
      expect(result.currentLine).toBe(11);
      expect(result.output).toContain('11|line 11');
    });

    it('scrolls up in the current file', async () => {
      await createTestFile('scroll2.ts', numberedLines(30));
      await backend.open('scroll2.ts', 20);

      const result = await backend.scroll('up');

      expect(result.exitCode).toBe(0);
      expect(result.currentLine).toBe(10);
      expect(result.output).toContain('10|line 10');
    });

    it('scrolls by custom amount', async () => {
      await createTestFile('scroll3.ts', numberedLines(30));
      await backend.open('scroll3.ts');

      const result = await backend.scroll('down', 5);

      expect(result.exitCode).toBe(0);
      expect(result.currentLine).toBe(6);
    });

    it('clamps to file boundaries', async () => {
      await createTestFile('scroll4.ts', numberedLines(5));
      await backend.open('scroll4.ts');

      const result = await backend.scroll('down', 100);
      expect(result.currentLine).toBe(5);

      const result2 = await backend.scroll('up', 100);
      expect(result2.currentLine).toBe(1);
    });

    it('returns error when no file is open', async () => {
      const result = await backend.scroll('down');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('No file is currently open');
    });
  });

  describe('gotoLine', () => {
    it('jumps to a specific line', async () => {
      await createTestFile('goto.ts', numberedLines(30));
      await backend.open('goto.ts');

      const result = await backend.gotoLine(15);

      expect(result.exitCode).toBe(0);
      expect(result.currentLine).toBe(15);
      expect(result.output).toContain('15|line 15');
    });

    it('returns error for out-of-range line', async () => {
      await createTestFile('goto2.ts', numberedLines(5));
      await backend.open('goto2.ts');

      const result = await backend.gotoLine(99);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('out of range');
    });

    it('returns error when no file is open', async () => {
      const result = await backend.gotoLine(1);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('No file is currently open');
    });
  });
});
