import { createHash } from 'node:crypto';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const out = process.env.MINION_HISTORY_FIXTURE_OUT;
const stubs = path.join(hub, 'src/server/test-utils/env-stubs');
if (!out || fs.existsSync(out))
  throw new Error('Set MINION_HISTORY_FIXTURE_OUT to a fresh owned artifact directory');
const inputs = new Set();
await build({
  configFile: false,
  root: hub,
  envDir: false,
  plugins: [
    tailwindcss(),
    svelte({ configFile: false }),
    {
      name: 'history-fixture-provenance',
      generateBundle() {
        for (const id of this.getModuleIds()) {
          const file = id.split('?')[0];
          if (file.startsWith(path.join(hub, 'src') + path.sep) && fs.existsSync(file))
            inputs.add(file);
        }
      },
    },
  ],
  define: { __APP_VERSION__: JSON.stringify('assistant-history-fixture') },
  resolve: {
    alias: [
      ...[
        '$lib/services/gateway.svelte',
        '$lib/state/features/voice-call.svelte',
        '$lib/access/can.svelte',
        '$lib/navigation',
        '$lib/state/agents/tool-catalog.svelte',
        '$lib/state/features/aliases.svelte',
      ].map((find) => ({ find, replacement: path.join(fixture, 'seams.ts') })),
      { find: '$app/state', replacement: path.join(stubs, 'app-state.ts') },
      { find: '$app/navigation', replacement: path.join(stubs, 'app-navigation.ts') },
      { find: '$app/environment', replacement: path.join(stubs, 'app-environment.ts') },
      { find: '$env/dynamic/private', replacement: path.join(stubs, 'dynamic-private.ts') },
      { find: '$env/dynamic/public', replacement: path.join(stubs, 'dynamic-public.ts') },
      { find: '$env/static/public', replacement: path.join(stubs, 'static-public.ts') },
      { find: '$lib', replacement: path.join(hub, 'src/lib') },
    ],
    dedupe: ['svelte'],
  },
  build: {
    outDir: out,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: path.join(fixture, 'main.ts'),
      output: { entryFileNames: 'entry.js', assetFileNames: '[name][extname]' },
    },
  },
});
fs.cpSync(path.join(hub, 'static/fonts'), path.join(out, 'fonts'), { recursive: true });
const css = fs
  .readdirSync(out)
  .filter((name) => name.endsWith('.css'))
  .map((name) => `<link rel="stylesheet" href="/${name}">`)
  .join('');
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Assistant history regression fixture</title></head><body><main><section id="assistant"><h2>Assistant history</h2></section><section id="user"><h2>User history</h2></section><section id="stream"><h2>Streaming override</h2></section><section id="answer"><h2>Seeded source link</h2></section></main><script type="module" src="/entry.js"></script></body></html>`,
);
fs.writeFileSync(
  path.join(out, 'fixture-source-manifest.json'),
  JSON.stringify(
    {
      purpose: 'Rendered local fixture only; synthetic answer data; no authenticated backend proof',
      sources: [...inputs].sort().map((file) => ({
        file: path.relative(hub, file),
        sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      })),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ fixtureOutput: out, productSourceCount: inputs.size }));
