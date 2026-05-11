// Fix Electrobun Linux bug: launcher expects bun/index.js but CLI produces bun/main.js
// Electrobun runs this with its bundled Bun runtime.

import { existsSync, symlinkSync, readdirSync } from 'fs';
import { join } from 'path';

const buildDir = process.env.ELECTROBUN_BUILD_DIR || 'build/dev-linux-x64';

function findAppBunDir(dir: string): string | null {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full.endsWith('/Resources/app/bun')) return full;
        const found = findAppBunDir(full);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

const appBunDir = findAppBunDir(buildDir);
if (
  appBunDir &&
  existsSync(join(appBunDir, 'main.js')) &&
  !existsSync(join(appBunDir, 'index.js'))
) {
  symlinkSync('main.js', join(appBunDir, 'index.js'));
  console.log('[postbuild] Created index.js symlink in', appBunDir);
} else {
  console.log('[postbuild] Skipped — index.js exists or main.js missing');
}
