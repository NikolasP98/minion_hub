import { build } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const out = process.env.MINION_MOTION_OUT;
if (!out || !path.isAbsolute(out) || fs.existsSync(out))
  throw Error('Fresh absolute motion fixture output required');
await build({
  configFile: false,
  envDir: false,
  root: hub,
  cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'minion-motion-cache-')),
  resolve: {
    alias: {
      '$lib/utils/avatar': fixture + 'assets.ts',
      '$lib/utils/agent-display': fixture + 'assets.ts',
      $lib: hub + 'src/lib',
    },
  },
  build: {
    target: 'esnext',
    outDir: out,
    emptyOutDir: false,
    minify: false,
    rollupOptions: { input: fixture + 'main.ts', output: { entryFileNames: 'entry.js' } },
  },
});
fs.writeFileSync(
  path.join(out, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native Workshop motion fixture</title></head><body><script type="module" src="/entry.js"></script></body></html>',
);
fs.writeFileSync(
  path.join(out, 'avatar.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#555"/></svg>',
);
console.log(JSON.stringify({ out }));
