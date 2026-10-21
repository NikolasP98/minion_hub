import { build } from 'vite';
import { createHash } from 'node:crypto';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const hub = fileURLToPath(new URL('../../../', import.meta.url));
const out = process.env.MINION_APP_BACKLOG_FIXTURE_OUT ?? '/tmp/minion-app-backlog-fixture';
await build({
  configFile: false,
  envDir: false,
  root: hub,
  cacheDir: '/tmp/minion-app-backlog-vite',
  plugins: [
    tailwindcss(),
    svelte({ configFile: false }),
    {
      name: 'app-backlog-provenance',
      generateBundle() {
        const hashes = {};
        for (const id of this.getModuleIds()) {
          const file = id.split('?')[0];
          if (file.startsWith(path.join(hub, 'src') + path.sep) && fs.existsSync(file))
            hashes[path.relative(hub, file)] = createHash('sha256')
              .update(fs.readFileSync(file))
              .digest('hex');
        }
        this.emitFile({
          type: 'asset',
          fileName: 'source-provenance.json',
          source: JSON.stringify(
            {
              sourceFiles: hashes,
              packageLock: createHash('sha256')
                .update(fs.readFileSync(path.join(hub, 'bun.lock')))
                .digest('hex'),
            },
            null,
            2,
          ),
        });
      },
    },
  ],
  define: { __APP_VERSION__: JSON.stringify('app-backlog-fixture') },
  resolve: {
    alias: {
      '$app/navigation': path.join(hub, 'src/server/test-utils/env-stubs/app-navigation.ts'),
      '$app/state': path.join(hub, 'src/server/test-utils/env-stubs/app-state.ts'),
      '$app/environment': path.join(hub, 'src/server/test-utils/env-stubs/app-environment.ts'),
      '$env/static/public': path.join(hub, 'src/server/test-utils/env-stubs/static-public.ts'),
      '$env/dynamic/public': path.join(hub, 'src/server/test-utils/env-stubs/dynamic-public.ts'),
      $lib: path.join(hub, 'src/lib'),
    },
    dedupe: ['svelte'],
  },
  build: {
    outDir: out,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./main.ts', import.meta.url)),
      output: { entryFileNames: 'entry.js', assetFileNames: '[name][extname]' },
    },
  },
});
const css = fs
  .readdirSync(out)
  .filter((name) => name.endsWith('.css'))
  .map((name) => `<link rel="stylesheet" href="/${name}">`)
  .join('');
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Hub backlog fixture</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);
fs.cpSync(path.join(hub, 'static/fonts'), path.join(out, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(hub, 'static/offline.html'), path.join(out, 'offline.html'));
console.log(out);
