import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  appPageFile,
  composedSource,
  compositionFailures,
  declaredPageShellArchetype,
  KNOWN_ARCHETYPE_DRIFT,
  KNOWN_NONCONFORMING,
  layoutChain,
  markupOf,
  PAGE_SHELL_ARCHETYPE,
  shellOwningLayouts,
} from './archetype-composition';
import { SCREEN_DESIGN_MANIFEST, type RouteArchetype } from './route-design-manifest';

/** Every manifest screen that lives in the `(app)` group — public routes carry no recipe. */
const screens = SCREEN_DESIGN_MANIFEST.flatMap((s) => {
  const file = appPageFile(s.pattern);
  return file ? [{ pattern: s.pattern, archetype: s.archetype, file }] : [];
});

describe('route archetype composition (spec 013 FR-004)', () => {
  it('checks every app screen the design manifest declares', () => {
    expect(screens.length).toBeGreaterThan(100);
    const unknown = Object.keys(KNOWN_NONCONFORMING).filter(
      (p) => !screens.some((s) => s.pattern === p),
    );
    expect(unknown, 'allow-list names screens that are not manifest app pages').toEqual([]);
  });

  it('is layout-aware: shells owned by a layout count for every page below it', () => {
    const owners = shellOwningLayouts();
    expect(owners.length).toBeGreaterThanOrEqual(16);
    // /stock/items has no PageShell of its own in the layout chain's ROOT but its
    // sibling /stock/entries inherits the shell from stock/+layout.svelte.
    const chain = layoutChain('src/routes/(app)/stock/entries/+page.svelte');
    expect(chain.some((f) => f.endsWith('stock/+layout.svelte'))).toBe(true);
    expect(
      markupOf(readFileSync('src/routes/(app)/stock/entries/+page.svelte', 'utf8')),
    ).not.toContain('<PageShell');
    expect(composedSource('src/routes/(app)/stock/entries/+page.svelte')).toContain('<PageShell');
  });

  it.each(screens.map((s) => [s.pattern, s.archetype, s.file] as const))(
    '%s composes like %s',
    (pattern, archetype, file) => {
      const failures = compositionFailures(archetype, composedSource(file));
      if (pattern in KNOWN_NONCONFORMING) {
        expect(
          failures,
          `${pattern} conforms now — remove it from KNOWN_NONCONFORMING`,
        ).not.toEqual([]);
        return;
      }
      expect(failures, `${pattern} (${archetype}) is missing: ${failures.join(', ')}`).toEqual([]);
    },
  );

  it('keeps a literal PageShell archetype equal to the manifest archetype (drift is listed debt)', () => {
    const drift = screens.flatMap(({ pattern, archetype, file }) => {
      const declared = declaredPageShellArchetype(composedSource(file));
      return declared && declared !== PAGE_SHELL_ARCHETYPE[archetype] ? [pattern] : [];
    });
    expect(drift.sort()).toEqual(Object.keys(KNOWN_ARCHETYPE_DRIFT).sort());
  });

  it('reports conforming / allow-listed counts per archetype', () => {
    const archetypes = [...new Set(screens.map((s) => s.archetype))] as RouteArchetype[];
    const rows = archetypes.map((a) => {
      const ids = screens.filter((s) => s.archetype === a).map((s) => s.pattern);
      const debt = ids.filter((id) => id in KNOWN_NONCONFORMING).length;
      return `${a.padEnd(24)} ${String(ids.length - debt).padStart(3)} conforming ${String(debt).padStart(3)} allow-listed`;
    });
    console.info(`archetype composition (${screens.length} app screens)\n${rows.join('\n')}`);
  });
});

describe('composition checker', () => {
  it('fails a seeded collection page that lost its header and toolbar', () => {
    const seeded = `<PageShell archetype="collection" scroll="region">
  <div class="cards">{#each rows as r}<Card>{r.name}</Card>{/each}</div>
</PageShell>`;
    expect(compositionFailures('collection', seeded)).toEqual([
      'PageHeader',
      'one toolbar (DataView | FilterToolbar | DataTable)',
    ]);
  });

  it('passes the collection recipe and a layout-owned settings shell', () => {
    expect(
      compositionFailures(
        'collection',
        '<PageShell archetype="collection" scroll="region"><PageHeader title="x" /><DataTable rows={rows} /></PageShell>',
      ),
    ).toEqual([]);
    expect(compositionFailures('form-settings', '<SectionShell><Card /></SectionShell>')).toEqual(
      [],
    );
    expect(compositionFailures('form-settings', '<div><Card /></div>')).toEqual([
      'SectionShell | SettingsNav, or PageShell + a form commit',
    ]);
  });
});
