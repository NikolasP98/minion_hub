import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const START = '/* MINION_GENERATED_BRIDGE_START */';
export const END = '/* MINION_GENERATED_BRIDGE_END */';
const HUB = fileURLToPath(new URL('../../', import.meta.url));
const META = path.dirname(HUB.replace(/\/$/, ''));
const ADAPTER = path.join(HUB, 'src/lib/artifacts/artifact-bridge.ts');
export const ENTRY = path.join(META, 'minion/packages/plugin-ui-bridge/dist/index.js');
const SOURCE = path.join(META, 'minion/packages/plugin-ui-bridge/src/index.ts');
const GENERATOR = fileURLToPath(import.meta.url);
const PACKAGE_LICENSE = path.join(META, 'minion/LICENSE');
const TOOL_LICENSE = path.join(HUB, 'node_modules/rolldown/LICENSE');
const HELPER_NOTICES = path.join(HUB, 'scripts/artifacts/inline-bridge-NOTICES.txt');
const ENTRY_HASH = '4f7bd0418fdf85d8a3206cab1c9f3db767de7dc5745a93fbb73b6ab110a098d6';
const SOURCE_HASH = 'cd8380839105f35ee996a5d6e893f87a3dd676616b4c2be9c827f55b150e4862';
const LOCK_HASH = '61deca9dcee043e017f4af70f8e5250281b44930a6beb81dbcff1ffb5756c196';
// Exact compiler helper bytes and retained upstream notices were verified together.
// Broader package release/provenance remains a separate distribution gate.
export const HELPERS = Object.freeze({
  '\0@oxc-project+runtime@0.139.0/helpers/esm/defineProperty.js':
    '2bad7c96ee851cf2cfe1320a54fd88dd5f769a7faf8bd92d60c9f2e6d1e381dd',
  '\0@oxc-project+runtime@0.139.0/helpers/esm/toPrimitive.js':
    '9660291e71923cb5ff9aaaa1de354515c26e3220cba56ac5d21b806f23875545',
  '\0@oxc-project+runtime@0.139.0/helpers/esm/toPropertyKey.js':
    '7f0000acc9c9cf7594b412095be66cdc59066b25458a16fe1434fd00cff478e7',
  '\0@oxc-project+runtime@0.139.0/helpers/esm/typeof.js':
    '928bcbbdf74fe24ed7486e7f982c4389c1859886b3ed904ebd2677f22193b57a',
});
export const TARGETS = Object.freeze(['overview', 'triage', 'artifact-builder']);
const BUILTIN = path.join(HUB, 'src/lib/artifacts/builtin');
const PROVENANCE = path.join(BUILTIN, 'bridge.provenance.json');
/** @param {string | Uint8Array} bytes */
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {string | Uint8Array} bytes @param {string} expected */
export function assertDigest(bytes, expected) {
  if (digest(bytes) !== expected) throw new Error('Unreviewed input digest');
}
/** @param {string} filename */
const logical = (filename) =>
  filename.startsWith('\0') ? filename : path.relative(META, filename).split(path.sep).join('/');
const settings = Object.freeze({
  formats: ['iife'],
  name: 'generatedPluginBridge',
  target: 'es2020',
  minify: false,
  sourcemap: false,
  write: false,
  configFile: false,
  envFile: false,
  envDir: false,
});

/** @param {string} filename @param {string} [expected] */
async function input(filename, expected) {
  const bytes = await readFile(filename);
  const sha256 = digest(bytes);
  if (expected) assertDigest(bytes, expected);
  return { path: logical(filename), sha256 };
}

/**
 * Public for offline negative graph tests; production passes actual build output.
 * @param {Array<{type: string, imports?: string[], dynamicImports?: string[], map?: unknown, referencedFiles?: string[], modules?: Record<string, unknown>, code?: string}>} result
 * @param {string[]} allowedModules
 */
export function validateOutput(result, allowedModules) {
  if (!Array.isArray(result) || result.length !== 1 || result[0].type !== 'chunk')
    throw new Error('Expected one standalone JavaScript chunk');
  const chunk = result[0];
  if (typeof chunk.code !== 'string' || !chunk.modules || !chunk.imports || !chunk.dynamicImports)
    throw new Error('Incomplete JavaScript chunk');
  if (
    chunk.imports.length ||
    chunk.dynamicImports.length ||
    chunk.map ||
    chunk.referencedFiles?.length
  )
    throw new Error('Unexpected runtime dependency or map');
  const actual = Object.keys(chunk.modules).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...allowedModules].sort()))
    throw new Error(`Unexpected module graph: ${JSON.stringify(actual)}`);
  if (/<\/script/i.test(chunk.code)) throw new Error('Unsafe closing-script sequence');
  const forbidden = chunk.code.match(
    /\b(?:eval\s*\(|new\s+Function\b|fetch\s*\(|XMLHttpRequest\s*\(|WebSocket\s*\(|import\s*\(|sourceMappingURL)/,
  );
  if (forbidden)
    throw new Error(`Unexpected dynamic execution or network bootstrap: ${forbidden[0]}`);
  if (!/\bgeneratedPluginBridge\b/.test(chunk.code)) throw new Error('Missing IIFE export');
  return chunk.code;
}

/** @param {Map<string, string>} graph @param {string[]} sourceModules */
export function validateGraph(graph, sourceModules) {
  const allowed = [...sourceModules, ...Object.keys(HELPERS)].sort();
  if (JSON.stringify([...graph.keys()].sort()) !== JSON.stringify(allowed))
    throw new Error('Unexpected module graph');
  for (const [id, expected] of Object.entries(HELPERS))
    if (graph.get(id) !== expected) throw new Error('Unreviewed compiler helper digest');
  return allowed;
}

export async function buildCandidate({ entry = ENTRY } = {}) {
  if (path.resolve(entry) !== ENTRY)
    throw new Error('Only the qualified package entry is admitted');
  const files = await Promise.all([
    input(ENTRY, ENTRY_HASH),
    input(SOURCE, SOURCE_HASH),
    input(ADAPTER),
    input(GENERATOR),
    input(path.join(HUB, 'bun.lock'), LOCK_HASH),
    input(
      path.join(HUB, 'node_modules/vite/package.json'),
      'f0999a86a4f852ef04de700f4dc42e43e40408b14bc8ee8a365c7defd3f90be6',
    ),
    input(
      path.join(HUB, 'node_modules/vite/dist/node/index.js'),
      '4892d68c0d1e7a55dd76c10962370136fb49887d7145942c2220d87ce9c9f24b',
    ),
    input(
      path.join(HUB, 'node_modules/rolldown/package.json'),
      '01de4c2d7ebcc0f36c92f41e4ecab383ae7f5dd2e26f8f4b640fc58ca9c8f8e7',
    ),
    input(path.join(META, 'minion/packages/plugin-ui-bridge/package.json')),
    input(PACKAGE_LICENSE, '62316704df7426e5a79d2827ff8aca36e9abb3a73b8e68557030749ebefec667'),
    input(TOOL_LICENSE, '23ecfff35a5a2e80d92142f75228912c3b1abc4b5a8337a821ff4397e2f9f734'),
    input(HELPER_NOTICES, '06f999033b552ad451e700f5badb54988d72964e2c68d7ce49361750627cc989'),
  ]);
  const vite = JSON.parse(await readFile(path.join(HUB, 'node_modules/vite/package.json'), 'utf8'));
  if (vite.version !== '8.1.3') throw new Error('Unreviewed Vite version');
  const allowed = await Promise.all([realpath(ADAPTER), realpath(ENTRY)]);
  /** @type {Map<string, string>} */
  const graph = new Map();
  const result = await build({
    configFile: false,
    envFile: false,
    envDir: false,
    root: HUB,
    logLevel: 'silent',
    resolve: { alias: [{ find: /^@nikolasp98\/plugin-ui-bridge$/, replacement: ENTRY }] },
    plugins: [
      {
        name: 'artifact-input-provenance',
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle))
            if (output.type === 'chunk') {
              for (const id of Object.keys(output.modules)) {
                const code = this.getModuleInfo(id)?.code;
                if (typeof code !== 'string') throw new Error(`Missing module source: ${id}`);
                graph.set(id, digest(code));
              }
            }
        },
      },
    ],
    build: {
      target: settings.target,
      minify: false,
      sourcemap: false,
      write: false,
      lib: { entry: ADAPTER, formats: ['iife'], name: settings.name },
    },
  });
  if (Array.isArray(result) && result.length !== 1) throw new Error('Unexpected build results');
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!bundle || !('output' in bundle))
    throw new Error('Expected an in-memory build, not a watcher');
  if (graph.get(allowed[1]) !== ENTRY_HASH) throw new Error('Package source changed during build');
  for (const file of files) assertDigest(await readFile(path.join(META, file.path)), file.sha256);
  const code = validateOutput(bundle.output, validateGraph(graph, allowed));
  const license = `${await readFile(PACKAGE_LICENSE, 'utf8')}\nBundler distribution notice:\n${await readFile(TOOL_LICENSE, 'utf8')}\n${await readFile(HELPER_NOTICES, 'utf8')}`;
  if (license.includes('*/') || /<\/script/i.test(license))
    throw new Error('Unsafe license comment');
  const region = `${START}\n/*! @nikolasp98/plugin-ui-bridge — repository license\n${license.trimEnd()}\n*/\n${code.trimEnd()}\n${END}`;
  return {
    region,
    provenance: {
      schemaVersion: 1,
      settings,
      inputs: files,
      modules: [...graph]
        .map(([id, sha256]) => ({ id: logical(id), sha256 }))
        .sort((a, b) => a.id.localeCompare(b.id, 'en')),
      emittedSha256: digest(code),
      regionSha256: digest(region),
      destinations: TARGETS.map((name) => ({
        path: `minion_hub/src/lib/artifacts/builtin/${name}/index.html`,
        regionSha256: digest(region),
      })),
    },
  };
}

/** @param {string} html @param {string} region */
export function replaceRegion(html, region) {
  const start = html.indexOf(START),
    end = html.indexOf(END);
  if (
    start < 0 ||
    end < start ||
    html.indexOf(START, start + START.length) >= 0 ||
    html.indexOf(END, end + END.length) >= 0
  )
    throw new Error('Invalid generated-region markers');
  const prefix = html.slice(0, start).toLowerCase();
  if (
    prefix.lastIndexOf('<script>') <= prefix.lastIndexOf('</script>') ||
    /<\/script/i.test(html.slice(start, end))
  )
    throw new Error('Generated region must be inside one inline script');
  return html.slice(0, start) + region + html.slice(end + END.length);
}

/** @param {string[]} htmls @param {string} provenanceText @param {Awaited<ReturnType<typeof buildCandidate>>} candidate */
export function checkArtifacts(htmls, provenanceText, candidate) {
  if (htmls.length !== TARGETS.length) throw new Error('Incomplete artifact set');
  for (const html of htmls)
    if (replaceRegion(html, candidate.region) !== html) throw new Error('Generated region differs');
  if (provenanceText !== `${JSON.stringify(candidate.provenance, null, 2)}\n`)
    throw new Error('Generated provenance differs');
}

async function main() {
  const mode = process.argv[2];
  if (!['--check', '--write'].includes(mode) || process.argv.length !== 3)
    throw new Error('Usage: build-inline-bridge.mjs --check|--write');
  const candidate = await buildCandidate();
  const targets = TARGETS.map((name) => path.join(BUILTIN, name, 'index.html'));
  for (const target of [...targets, PROVENANCE]) {
    try {
      if (
        (await lstat(target)).isSymbolicLink() ||
        (await realpath(path.dirname(target))) !== path.dirname(target)
      )
        throw new Error('Symlink output is not admitted');
    } catch (error) {
      if (!(
        target === PROVENANCE &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }
  const htmls = await Promise.all(targets.map((target) => readFile(target, 'utf8')));
  const next = htmls.map((html) => replaceRegion(html, candidate.region));
  if (mode === '--check') checkArtifacts(htmls, await readFile(PROVENANCE, 'utf8'), candidate);
  else {
    for (let i = 0; i < targets.length; i++) await writeFile(targets[i], next[i]);
    await writeFile(PROVENANCE, `${JSON.stringify(candidate.provenance, null, 2)}\n`);
  }
  process.stdout.write(
    `Inline bridge ${mode.slice(2)} passed: ${candidate.provenance.regionSha256}\n`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === GENERATOR) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
