import { describe, expect, it } from 'vitest';
import {
  groupPrs,
  parseConventionalTitle,
  renderChangelogSection,
} from './release-notes.mjs';

// Fixed list of real-shaped squash-merge subjects (as git log --format=%s
// would hand back), exercising feat/fix/other + scoped/unscoped + the
// trailing "(#NNN)" squash-merge suffix.
const FIXED_TITLES = [
  { number: 501, title: 'feat(pos): add package redemption chip (#501)', url: 'u1' },
  { number: 502, title: 'fix(scheduling): correct overdue boundary at 30m (#502)', url: 'u2' },
  { number: 503, title: 'refactor(hub): split inbox service (#503)', url: 'u3' },
  { number: 504, title: 'chore: bump dependency (#504)', url: 'u4' },
  { number: 505, title: 'bump the lockfile (#505)', url: 'u5' }, // non-conventional
  { number: 506, title: 'feat(pos): a second POS feature (#506)', url: 'u6' },
];

describe('parseConventionalTitle', () => {
  it('maps feat/fix/refactor/chore to Nuevo/Arreglado/Interno and extracts the scope', () => {
    expect(parseConventionalTitle(FIXED_TITLES[0].title)).toEqual({
      label: 'Nuevo',
      scope: 'pos',
      sentence: 'add package redemption chip',
    });
    expect(parseConventionalTitle(FIXED_TITLES[1].title)).toEqual({
      label: 'Arreglado',
      scope: 'scheduling',
      sentence: 'correct overdue boundary at 30m',
    });
    expect(parseConventionalTitle(FIXED_TITLES[2].title)).toEqual({
      label: 'Interno',
      scope: 'hub',
      sentence: 'split inbox service',
    });
    expect(parseConventionalTitle(FIXED_TITLES[3].title)).toEqual({
      label: 'Interno',
      scope: '',
      sentence: 'bump dependency',
    });
  });

  it('falls back to Interno with no scope for a non-conventional title', () => {
    expect(parseConventionalTitle(FIXED_TITLES[4].title)).toEqual({
      label: 'Interno',
      scope: '',
      sentence: 'bump the lockfile',
    });
  });
});

describe('groupPrs', () => {
  it('groups the fixed title list by label then scope', () => {
    const sections = groupPrs(FIXED_TITLES);
    expect(sections).toEqual({
      Nuevo: {
        pos: ['add package redemption chip', 'a second POS feature'],
      },
      Arreglado: {
        scheduling: ['correct overdue boundary at 30m'],
      },
      Interno: {
        hub: ['split inbox service'],
        '': ['bump dependency', 'bump the lockfile'],
      },
    });
  });

  it('returns an empty object for an empty PR list', () => {
    expect(groupPrs([])).toEqual({});
  });
});

describe('renderChangelogSection', () => {
  it('renders a dated section with one bullet per sentence, scope bolded when present', () => {
    const sections = groupPrs(FIXED_TITLES);
    const out = renderChangelogSection('hub-v2026.10.10', '2026-10-10T12:00:00Z', sections);
    expect(out).toContain('## hub-v2026.10.10 — 2026-10-10');
    expect(out).toContain('### Nuevo');
    expect(out).toContain('- **pos**: add package redemption chip');
    expect(out).toContain('- **pos**: a second POS feature');
    expect(out).toContain('### Arreglado');
    expect(out).toContain('- **scheduling**: correct overdue boundary at 30m');
    expect(out).toContain('- bump dependency');
  });
});
