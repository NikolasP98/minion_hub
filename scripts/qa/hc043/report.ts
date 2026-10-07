/** Print the HC-043 static contrast matrix. `bun scripts/qa/hc043/report.ts [--json out.json]` */
import { writeFileSync } from 'node:fs';
import { measureAll, SURFACES, type Measurement } from './resolve';

const rows = measureAll();
const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx !== -1) writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(rows, null, 2));

const live = rows.filter((r) => r.host === '--color-surface-2');
const byTheme = new Map<string, Measurement[]>();
for (const r of live) (byTheme.get(r.theme) ?? byTheme.set(r.theme, []).get(r.theme)!).push(r);

const f = (n: number) => n.toFixed(2).padStart(6);
console.log('host = --color-surface-2 (live DetailPanel chain). Columns: blue accent | min over 10 runtime accents (worst accent)');
console.log(`${'theme'.padEnd(18)} | ${SURFACES.map((s) => s.padEnd(27)).join(' | ')}`);
for (const [theme, list] of byTheme) {
  const cells = SURFACES.map((s) => {
    const blue = list.find((r) => r.surface === s && r.accent === 'blue')!;
    const runtime = list.filter((r) => r.surface === s && r.accent !== 'theme-default');
    const worst = runtime.reduce((a, b) => (a.ratio < b.ratio ? a : b));
    return `${f(blue.ratio)} | ${f(worst.ratio)} ${worst.accent.padEnd(8)}`;
  });
  console.log(`${theme.padEnd(18)} | ${cells.join(' | ')}`);
}
const fails = rows.filter((r) => r.ratio < 4.5);
console.log(`\n${rows.length} measurements, ${fails.length} below 4.5:1`);
for (const s of SURFACES) {
  const n = fails.filter((r) => r.surface === s).length;
  const total = rows.filter((r) => r.surface === s).length;
  console.log(`  ${s.padEnd(9)} ${n}/${total} failing`);
}
