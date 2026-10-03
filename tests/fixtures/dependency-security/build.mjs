import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { assertClientBundleBoundary } from '../../../scripts/qc/client-bundle-boundary.mjs';

const fixture = fileURLToPath(new URL('./', import.meta.url));
const output = process.env.MINION_DEPENDENCY_OUT;
if (!output || !path.isAbsolute(output) || fs.existsSync(output)) {
  throw new Error('MINION_DEPENDENCY_OUT must be a fresh absolute path');
}
const mutation = process.env.MINION_DEPENDENCY_MUTATION ?? 'none';
const allowedMutations = new Set(['none', 'editor-paste', 'ordinary-sanitizer']);
if (!allowedMutations.has(mutation)) throw new Error('Unknown dependency security mutation');
if (mutation !== 'none' && process.env.MINION_DEPENDENCY_MUTATION_CANARY !== '1') {
  throw new Error('Dependency security mutations require the mutation qualification runner');
}

const modules = new Set();
await build({
  root: fixture,
  configFile: false,
  envDir: false,
  publicDir: false,
  cacheDir: path.join(process.env.TMPDIR ?? fixture, 'dependency-security-vite'),
  define: {
    __MINION_DEPENDENCY_MUTATION__: JSON.stringify(mutation),
  },
  plugins: [
    {
      name: 'dependency-security-provenance',
      generateBundle() {
        for (const id of this.getModuleIds()) modules.add(id);
      },
    },
  ],
  build: {
    target: 'es2022',
    outDir: output,
    emptyOutDir: false,
    minify: false,
    rollupOptions: { input: path.join(fixture, 'index.html') },
  },
});
fs.chmodSync(output, 0o700);

function list(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in dependency fixture: ${file}`);
    return entry.isDirectory() ? list(file) : [file];
  });
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const outputFiles = list(output);
const artifacts = outputFiles
  .filter((file) => /\.(?:html|js|mjs)$/i.test(file))
  .map((file) => ({ path: path.relative(output, file), source: fs.readFileSync(file, 'utf8') }));
const boundary = assertClientBundleBoundary({
  label: 'dependency-security browser fixture',
  modules: [...modules],
  artifacts,
});
const files = outputFiles.map((file) => ({
  path: path.relative(output, file),
  size: fs.statSync(file).size,
  sha256: sha256(fs.readFileSync(file)),
}));
if (files.length === 0 || files.length > 30)
  throw new Error('Unexpected dependency artifact count');
if (files.reduce((total, file) => total + file.size, 0) > 5 * 1024 * 1024) {
  throw new Error('Dependency fixture exceeds 5 MiB');
}
fs.writeFileSync(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    { files, modules: [...modules].sort(), boundary, mutation, envFile: false, envDir: false },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(JSON.stringify({ output, files: files.length, boundary }));
