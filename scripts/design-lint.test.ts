import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const roots: string[] = [];
const script = resolve('scripts/design-lint.mjs');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-lint-contract-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'src/legacy.svelte'), '<div style="color: #ffffff">Text</div>');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  // This is a disposable test repository, not the release checkout.
  git('config', '--local', 'commit.gpgsign', 'false');
  git('add', 'src');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/master', 'HEAD');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      env: {
        ...process.env,
        DESIGN_LINT_ROOT: root,
        DESIGN_LINT_BASE_REF: '',
        GITHUB_BASE_REF: '',
      },
      encoding: 'utf8',
    });
  return { root, run };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('enforcing design debt checks', { timeout: 30_000 }, () => {
  it('uses the Hub registered base and rejects a missing base without --ci', () => {
    const { run } = fixture();
    expect(run().status).toBe(0);
    const missing = run('--base-ref', 'origin/missing');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('unavailable');
  });
  it('rejects debt transferred to an untracked file even when totals stay equal', () => {
    const { root, run } = fixture();
    writeFileSync(join(root, 'src/legacy.svelte'), '<div>Text</div>');
    writeFileSync(join(root, 'src/new.svelte'), '<div style="color: #ffffff">Text</div>');
    expect(run().status).toBe(1);
  });
  it('accepts decreases and catches new CSS debt', () => {
    const { root, run } = fixture();
    writeFileSync(join(root, 'src/legacy.svelte'), '<div>Text</div>');
    expect(run().status).toBe(0);
    writeFileSync(join(root, 'src/new.css'), '.example { z-index: 99; color: #ffffff; }');
    const regression = run();
    expect(regression.status).toBe(1);
    expect(regression.stdout).toContain('src/new.css');
  });
});
describe('global ceilings', { timeout: 30_000 }, () => {
  it('--strict-global fails on a seeded over-ceiling total and passes at the ceiling', () => {
    const { root, run } = fixture();
    const baseline = (rawColor: number) =>
      writeFileSync(
        join(root, 'scripts/.design-lint-baseline.json'),
        JSON.stringify({ totals: { 'raw-color': rawColor } }),
      );
    baseline(0);
    const over = run('--ci', '--strict-global');
    expect(over.status).toBe(1);
    expect(over.stdout).toContain('OVER global ceiling');
    expect(run('--update-baseline').status).toBe(1);
    baseline(1);
    expect(run('--ci', '--strict-global').status).toBe(0);
  });
});

describe('icon-button-unlabelled (spec 152)', { timeout: 30_000 }, () => {
  it('counts an icon-only Button with no accessible name, and nothing else', () => {
    const { root, run } = fixture();
    writeFileSync(
      join(root, 'src/icons.svelte'),
      [
        // The one offender: the arrow function's `>` must not end the tag early.
        '<Button variant="ghost" onclick={() => go(1)}><X size={14} /></Button>',
        '<Button aria-label={m.close()} onclick={() => go()}><X size={14} /></Button>',
        '<Button aria-labelledby="a b"><X size={14} /></Button>',
        '<Button title="Close"><X size={14} /></Button>',
        '<Button {...rest}><X size={14} /></Button>',
        '<Button><X size={14} /> Close</Button>',
        '<Button class="card"><SellableCard row={s} /></Button>',
      ].join('\n'),
    );
    expect(run('--update-baseline').status).toBe(0);
    expect(run().stdout).toMatch(/icon-button-unlabelled\s+1\b/);
  });
});

describe('hardcoded-a11y-name and hardcoded-hint-text (spec 155)', { timeout: 30_000 }, () => {
  it('counts literal accessible names, and only in product files', () => {
    const { root, run } = fixture();
    writeFileSync(
      join(root, 'src/labels.svelte'),
      [
        // Three offenders: a literal label, a literal label prop, a literal alt.
        '<button aria-label="Close">x</button>',
        '<Nav ariaLabel="Account" />',
        '<img alt="Screenshot" src={a} />',
        // Translated, empty, or not text: fine.
        '<button aria-label={m.close()}>x</button>',
        '<img alt="" src={a} />',
        '<div data-aria-label="x"></div>',
      ].join('\n'),
    );
    // The same literals in a story are sample content.
    writeFileSync(join(root, 'src/labels.stories.svelte'), '<button aria-label="Close">x</button>');
    expect(run('--update-baseline').status).toBe(0);
    expect(run().stdout).toMatch(/hardcoded-a11y-name\s+3\b/);
  });

  it('counts literal title and placeholder copy, not format examples', () => {
    const { root, run } = fixture();
    writeFileSync(
      join(root, 'src/hints.svelte'),
      [
        // Two offenders.
        '<button title="Delete forever">x</button>',
        '<input placeholder="Your name" />',
        // A format example, a translated value, and a one-letter unit: fine.
        '<input placeholder="YYYY-MM-DD" />',
        '<input placeholder={m.name()} />',
        '<input placeholder="22" />',
      ].join('\n'),
    );
    expect(run('--update-baseline').status).toBe(0);
    expect(run().stdout).toMatch(/hardcoded-hint-text\s+2\b/);
  });
});
