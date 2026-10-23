import os from 'node:os';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertClientBundleBoundary } from '../../../scripts/qc/client-bundle-boundary.mjs';

const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-critical-build-'));
const out = process.env.MINION_CRITICAL_OUT;
if (!out || !path.isAbsolute(out) || fs.existsSync(out))
  throw Error('Fresh private output required');
const evidence = process.env.MINION_CRITICAL_EVIDENCE;
if (
  !evidence ||
  !path.isAbsolute(evidence) ||
  !fs.existsSync(evidence) ||
  fs.realpathSync(evidence) !== path.resolve(evidence)
)
  throw Error('Existing private evidence directory required');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const pulseOnly = process.env.MINION_CRITICAL_PULSE_ONLY === '1';
const pulseAuthority = [
  'src/routes/(app)/pulse/+page.svelte',
  'src/routes/(app)/notifications/+page.svelte',
  'src/lib/components/layout/NotificationsPopup.svelte',
  'src/lib/state/features/pulse.svelte.ts',
  'src/lib/components/pulse/PulseReceipt.svelte',
  'src/lib/components/pulse/PulseFeedback.svelte',
  'src/lib/components/pulse/PulseDigestEvidence.svelte',
  'tests/fixtures/critical-journeys/scheduled-proposal.json',
];
const baseAuthority = [
  'src/routes/(app)/home/+page.svelte',
  'src/routes/(app)/scheduling/calendar/+page.svelte',
  'src/lib/services/gateway.svelte.ts',
  'src/lib/services/gateway/chat-rpc.ts',
  'src/lib/components/settings/SecretEditModal.svelte',
  'src/lib/components/my-agent/ImageLightbox.svelte',
];
const authority = pulseOnly ? pulseAuthority : [...baseAuthority, ...pulseAuthority];
const transformed = new Set();
const modules = new Set();
// A prior bundle records selected authority hashes, not every transitive source input.
// Recompile so changed child components cannot inherit an old artifact receipt.
if (process.env.MINION_CRITICAL_REUSE)
  throw Error('Artifact reuse is unsupported; compile current source into fresh output');
const compilationReuse = null;
for (const mode of pulseOnly ? ['pulse'] : ['home', 'calendar', 'overlay', 'pulse']) {
  const mobile = path.join(hub, 'tests/fixtures/mobile-composition');
  const overlay = path.join(hub, 'tests/fixtures/overlay-native');
  const entry = '\0critical:' + mode;
  const source =
    mode === 'pulse'
      ? `import {installPulseTransport} from ${JSON.stringify(fixture + 'pulse-transport.ts')};installPulseTransport(); const {mount}=await import('svelte'); const {default:Fixture}=await import(${JSON.stringify(fixture + 'PulseFixture.svelte')}); await import(${JSON.stringify(hub + 'src/app.css')}); await import(${JSON.stringify(mobile + '/fixture.css')});mount(Fixture,{target:document.getElementById('app')});`
      : mode === 'home'
        ? `import {install} from ${JSON.stringify(fixture + 'gateway-transport.ts')};install(); const {mount}=await import('svelte'); const {default:Fixture}=await import(${JSON.stringify(fixture + 'HomeFixture.svelte')}); await import(${JSON.stringify(hub + 'src/app.css')}); await import(${JSON.stringify(mobile + '/fixture.css')});mount(Fixture,{target:document.getElementById('app')});`
        : `import ${JSON.stringify(mode === 'calendar' ? mobile + '/calendar.js' : overlay + '/main.js')};`;
  await build({
    base: '/' + mode + '/',
    logLevel: 'warn',
    configFile: false,
    envDir: false,
    root: hub,
    publicDir: path.join(hub, 'static'),
    experimental: {
      renderBuiltUrl(filename, { type }) {
        if (type === 'public' && filename.startsWith('fonts/')) return '/' + filename;
      },
    },
    cacheDir: path.join(base, 'cache', mode),
    plugins: [
      {
        name: 'critical-entry-and-provenance',
        resolveId(id) {
          if (id === entry) return id;
        },
        load(id) {
          if (id === entry) return source;
        },
        transform(_code, id) {
          if (id.startsWith(hub)) transformed.add(id.split('?')[0]);
        },
        generateBundle() {
          for (const id of this.getModuleIds()) modules.add(id);
        },
      },
      tailwindcss(),
      svelte({ configFile: false }),
    ],
    define: { __APP_VERSION__: JSON.stringify('critical-fixture') },
    resolve: {
      dedupe: ['svelte'],
      alias:
        mode === 'overlay'
          ? { '$lib/paraglide/messages': overlay + '/messages.js', $lib: hub + 'src/lib' }
          : {
              '$app/state':
                fixture + (mode === 'pulse' ? 'pulse-transport.ts' : 'gateway-transport.ts'),
              '$app/navigation':
                mode === 'pulse'
                  ? fixture + 'pulse-transport.ts'
                  : mobile + '/stubs/app-navigation.js',
              '$app/environment': mobile + '/stubs/app-environment.js',
              '$app/stores': mobile + '/stubs/app-stores.js',
              '$env/dynamic/public': mobile + '/stubs/env-public.js',
              '$env/static/public': mobile + '/stubs/env-public.js',
              $lib: hub + 'src/lib',
            },
    },
    build: {
      target: 'es2022',
      copyPublicDir: false,
      outDir: path.join(out, mode),
      emptyOutDir: false,
      minify: true,
      rollupOptions: {
        input: entry,
        output: {
          entryFileNames: 'entry.js',
          assetFileNames: '[name][extname]',
          // Each mode has one reviewed entry. Inline its lazy chunks so the
          // artifact cannot grow one file per editor grammar/theme while still
          // compiling the complete graph and preserving every runtime branch.
          codeSplitting: false,
        },
      },
    },
  });
  const css = fs
    .readdirSync(path.join(out, mode))
    .filter((x) => x.endsWith('.css'))
    .map((x) => `<link rel="stylesheet" href="/${mode}/${x}">`)
    .join('');
  fs.writeFileSync(
    path.join(out, mode + '.html'),
    `<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Critical fixture ${mode}</title><div id="app"></div><script type="module" src="/${mode}/entry.js"></script></html>`,
  );
}
const fontNames = [
  ...new Set(
    [
      ...fs
        .readFileSync(path.join(hub, 'src/app.css'), 'utf8')
        .matchAll(/url\(['"]?\/fonts\/([A-Za-z0-9_.-]+\.woff2)['"]?\)/g),
    ].map((match) => match[1]),
  ),
];
if (fontNames.length !== 10) throw Error('Re-review changed font inputs');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const name of fontNames) {
  const input = path.join(hub, 'static/fonts', name);
  if (fs.realpathSync(input) !== input) throw Error('Linked font input');
  fs.copyFileSync(input, path.join(out, 'fonts', name));
}
function list(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((item) =>
      item.isDirectory() ? list(path.join(dir, item.name)) : [path.join(dir, item.name)],
    );
}
const files = list(out).map((file) => ({
  path: path.relative(out, file),
  size: fs.statSync(file).size,
  sha256: sha(fs.readFileSync(file)),
}));
// Font assets are shared at the manifest root even though each entry has its own base.
for (const file of list(out).filter((file) => file.endsWith('.css'))) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/url\(([^)]+)\)/g)) {
    const url = match[1].replace(/["']/g, '');
    if (url.includes('/fonts/') && !url.startsWith('/fonts/'))
      throw Error('Unexpected fixture font base: ' + url);
  }
}
const artifacts = list(out)
  .filter((file) => /\.(?:html|js|mjs)$/i.test(file))
  .map((file) => ({ path: path.relative(out, file), source: fs.readFileSync(file, 'utf8') }));
const boundary = assertClientBundleBoundary({
  label: 'critical-journeys browser fixture',
  modules: [...modules],
  artifacts,
});
fs.writeFileSync(
  path.join(evidence, 'critical-module-graph.json'),
  JSON.stringify(
    { transformed: [...transformed].sort(), modules: [...modules].sort(), boundary },
    null,
    2,
  ),
  { mode: 0o600 },
);
if (files.length > 550 || files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024)
  throw Error('Artifact capacity exceeded');
for (const rel of authority)
  if (!transformed.has(hub + rel)) throw Error('Authority not compiled: ' + rel);
const clients = [...modules].filter(
  (p) => p.includes('@minion-stack/shared') && p.endsWith('/gateway/client.js'),
);
if (!pulseOnly && clients.length !== 1)
  throw Error('Actual installed shared client missing/ambiguous');
fs.writeFileSync(
  path.join(out, 'manifest.json'),
  JSON.stringify(
    {
      files,
      compilationReuse,
      profile: pulseOnly ? 'pulse' : 'base-and-pulse',
      authority: [...authority.map((p) => hub + p), ...clients].map((p) => ({
        path: p,
        sha256: sha(fs.readFileSync(p)),
      })),
      envFile: false,
      envDir: false,
      modules: [...modules].sort(),
      boundary,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ out, files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) }),
);
