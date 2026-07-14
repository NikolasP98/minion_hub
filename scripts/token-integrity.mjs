#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDir, '..');
const requireFromHub = createRequire(join(defaultRoot, 'package.json'));

const SOURCE_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs', '.scss', '.svelte', '.ts']);

/** Tokens that are not optional component inputs: they are retired names whose
 * return would silently split the Hub away from the shared semantic contract. */
export const FORBIDDEN_LEGACY_TOKENS = new Set([
  '--accent',
  '--accent-bg',
  '--accent-rgb',
  '--color-background',
  '--color-bg1',
  '--color-error',
  '--color-primary',
  '--color-primary-foreground',
]);

const THEME_COLOR_TOKENS = new Set([
  '--color-canvas',
  '--color-surface-1',
  '--color-surface-2',
  '--color-surface-3',
  '--color-overlay',
  '--color-border-subtle',
  '--color-border-default',
  '--color-border-strong',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-disabled',
  '--color-accent',
  '--color-on-accent',
  '--color-brand',
]);

for (const status of ['success', 'warning', 'danger', 'info']) {
  for (const role of ['fg', 'surface', 'border']) {
    THEME_COLOR_TOKENS.add(`--color-${status}-${role}`);
  }
}

const COMPONENT_INPUTS = new Map([
  ['src/lib/components/builder/ChapterDAG.svelte\0--color-dag-bg', 'chapter DAG surface override'],
  ['src/lib/components/data-table/DataTable.svelte\0--dt-agg-color', 'aggregate label colour override'],
  ['src/lib/components/channels/WhatsAppQrPairing.svelte\0--color-qr-canvas', 'QR contrast canvas override'],
  ['src/lib/components/channels/WhatsAppQrPairing.svelte\0--color-qr-ink-muted', 'QR instruction ink override'],
]);

const THIRD_PARTY_RUNTIME_INPUTS = new Map([
  ['src/lib/components/layout/ToastItem.svelte\0--y', 'Zag toast positioning'],
  ['src/lib/components/layout/ToastItem.svelte\0--opacity', 'Zag toast visibility'],
  ['src/lib/components/layout/ToastItem.svelte\0--z-index', 'Zag toast stacking'],
  ['src/lib/components/layout/ToastItem.svelte\0--height', 'Zag toast presence animation'],
]);

const THIRD_PARTY_PREFIXES = ['--tw-', '--xy-'];

function isInComment(source, index) {
  const lastBlockOpen = source.lastIndexOf('/*', index);
  const lastBlockClose = source.lastIndexOf('*/', index);
  if (lastBlockOpen > lastBlockClose) return true;
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const lineComment = source.indexOf('//', lineStart);
  return lineComment >= 0 && lineComment < index;
}

function lineAndColumn(source, index) {
  const before = source.slice(0, index);
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function hasFallback(source, openParenIndex) {
  let depth = 0;
  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return false;
    }
    if (character === ',' && depth === 1) return true;
  }
  return false;
}

export function extractVarConsumers(source, file = '<memory>') {
  const consumers = [];
  const pattern = /var\(\s*(--[A-Za-z0-9_-]+)/g;
  for (const match of source.matchAll(pattern)) {
    if (isInComment(source, match.index)) continue;
    const token = match[1];
    const tokenEnd = match.index + match[0].length;
    const position = lineAndColumn(source, match.index);
    consumers.push({
      file,
      token,
      ...position,
      hasFallback: hasFallback(source, source.indexOf('(', match.index)),
      dynamicTemplate: source.slice(tokenEnd, tokenEnd + 2) === '${',
    });
  }
  return consumers;
}

function extractDeclarations(source, file) {
  const declarations = [];
  const cssDeclaration = /(^|[;{\s"'`])(--[A-Za-z0-9_-]+)\s*:/gm;
  for (const match of source.matchAll(cssDeclaration)) {
    if (isInComment(source, match.index)) continue;
    declarations.push({ file, token: match[2], origin: 'css-definition' });
  }

  const styleDirective = /style:(--[A-Za-z0-9_-]+)/g;
  for (const match of source.matchAll(styleDirective)) {
    if (isInComment(source, match.index)) continue;
    declarations.push({ file, token: match[1], origin: 'runtime-authored' });
  }

  const setProperty = /setProperty\(\s*['"](--[A-Za-z0-9_-]+)['"]/g;
  for (const match of source.matchAll(setProperty)) {
    if (isInComment(source, match.index)) continue;
    declarations.push({ file, token: match[1], origin: 'runtime-authored' });
  }
  return declarations;
}

function collectContractKeys(value, tokens) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('--')) tokens.add(key);
    if (typeof child === 'string' && child.startsWith('--')) tokens.add(child);
    collectContractKeys(child, tokens);
  }
}

function resolvePackageFile(rootDir, subpath) {
  try {
    return createRequire(join(rootDir, 'package.json')).resolve(`@minion-stack/design-tokens/${subpath}`);
  } catch {
    try {
      return requireFromHub.resolve(`@minion-stack/design-tokens/${subpath}`);
    } catch {
      return null;
    }
  }
}

function resolveContractPath(rootDir, explicitPath) {
  const candidates = [
    explicitPath,
    process.env.MINION_DESIGN_TOKEN_CONTRACT,
    resolvePackageFile(rootDir, 'contract.json'),
    join(rootDir, '..', 'packages', 'design-tokens', 'contract.json'),
    join(rootDir, '..', '..', '..', 'packages', 'design-tokens', 'contract.json'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function loadSharedTokenContract(rootDir = defaultRoot, explicitPath) {
  const contractPath = resolveContractPath(rootDir, explicitPath);
  if (!contractPath) {
    throw new Error(
      'Unable to locate @minion-stack/design-tokens/contract.json. Install dependencies or set MINION_DESIGN_TOKEN_CONTRACT.',
    );
  }
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const tokens = new Set(THEME_COLOR_TOKENS);
  collectContractKeys(contract, tokens);

  const generatedCssPath = resolvePackageFile(rootDir, 'tokens.css');
  if (generatedCssPath && existsSync(generatedCssPath)) {
    for (const declaration of extractDeclarations(readFileSync(generatedCssPath, 'utf8'), generatedCssPath)) {
      tokens.add(declaration.token);
    }
  }
  return { contractPath, generatedCssPath, tokens };
}

function walkSourceFiles(rootDir, sourceDirs) {
  const files = [];
  const visit = (absolutePath) => {
    if (!existsSync(absolutePath)) return;
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const child = join(absolutePath, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(child);
    }
  };
  for (const directory of sourceDirs) visit(join(rootDir, directory));
  return files.sort();
}

function exceptionFor(consumer) {
  const key = `${consumer.file}\0${consumer.token}`;
  if (consumer.dynamicTemplate) return { reason: 'runtime-template', detail: 'computed token name' };
  if (THIRD_PARTY_RUNTIME_INPUTS.has(key) && consumer.hasFallback) {
    return { reason: 'third-party-runtime', detail: THIRD_PARTY_RUNTIME_INPUTS.get(key) };
  }
  if (THIRD_PARTY_PREFIXES.some((prefix) => consumer.token.startsWith(prefix))) {
    return { reason: 'third-party-contract', detail: 'framework-owned custom property' };
  }
  if (consumer.file.startsWith('src/lib/artifacts/builtin/') && consumer.token === '--radius' && consumer.hasFallback) {
    return { reason: 'render-surface', detail: 'artifact host token with standalone fallback' };
  }
  if (COMPONENT_INPUTS.has(key) && consumer.hasFallback) {
    return { reason: 'component-input', detail: COMPONENT_INPUTS.get(key) };
  }
  return null;
}

export function auditTokenSources({ sources, contractTokens = new Set() }) {
  const declarationOrigins = new Map();
  const forbiddenDefinitions = [];
  for (const token of contractTokens) declarationOrigins.set(token, new Set(['shared-contract']));

  for (const source of sources) {
    for (const declaration of extractDeclarations(source.text, source.file)) {
      if (!declarationOrigins.has(declaration.token)) declarationOrigins.set(declaration.token, new Set());
      declarationOrigins.get(declaration.token).add(declaration.origin);
      if (FORBIDDEN_LEGACY_TOKENS.has(declaration.token)) {
        forbiddenDefinitions.push({
          ...declaration,
          line: source.text.slice(0, source.text.indexOf(declaration.token)).split('\n').length,
          kind: 'forbidden-definition',
        });
      }
    }
  }

  const consumers = sources.flatMap((source) => extractVarConsumers(source.text, source.file));
  const unresolved = [...forbiddenDefinitions];
  const reasonCoded = [];

  for (const consumer of consumers) {
    if (FORBIDDEN_LEGACY_TOKENS.has(consumer.token)) {
      unresolved.push({ ...consumer, kind: 'forbidden-consumer' });
      continue;
    }
    const origins = declarationOrigins.get(consumer.token);
    if (origins) {
      if (origins.has('runtime-authored') && !origins.has('shared-contract') && !origins.has('css-definition')) {
        reasonCoded.push({ ...consumer, reason: 'runtime-authored', detail: 'set by style directive or setProperty' });
      }
      continue;
    }
    const exception = exceptionFor(consumer);
    if (exception) reasonCoded.push({ ...consumer, ...exception });
    else unresolved.push({ ...consumer, kind: 'undefined-consumer' });
  }

  return {
    consumers,
    declarationOrigins,
    reasonCoded,
    unresolved,
  };
}

export function scanTokenIntegrity({ rootDir = defaultRoot, sourceDirs = ['src', 'static'], contractPath } = {}) {
  const shared = loadSharedTokenContract(rootDir, contractPath);
  const files = walkSourceFiles(rootDir, sourceDirs);
  const sources = files.map((absolutePath) => ({
    file: relative(rootDir, absolutePath).replaceAll('\\', '/'),
    text: readFileSync(absolutePath, 'utf8'),
  }));
  return {
    rootDir,
    files,
    shared,
    ...auditTokenSources({ sources, contractTokens: shared.tokens }),
  };
}

function printReport(result) {
  console.log('\n  token-integrity — CSS custom-property contract\n');
  console.log(`  files       ${result.files.length}`);
  console.log(`  consumers   ${result.consumers.length}`);
  console.log(`  declared    ${result.declarationOrigins.size}`);
  console.log(`  contract    ${relative(result.rootDir, result.shared.contractPath)}`);
  console.log(`  exceptions  ${result.reasonCoded.length} reason-coded`);

  const reasons = new Map();
  for (const item of result.reasonCoded) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  for (const [reason, count] of [...reasons].sort()) {
    console.log(`               ${String(count).padStart(4)}  ${reason}`);
  }

  if (result.unresolved.length > 0) {
    console.log(`\n  violations  ${result.unresolved.length}\n`);
    for (const item of result.unresolved) {
      console.log(
        `  ✕ ${item.file}:${item.line}:${item.column ?? 1}  ${item.token}  ${item.kind}${item.hasFallback ? ' (has fallback)' : ''}`,
      );
    }
  } else {
    console.log('\n  violations     0\n');
  }
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = scanTokenIntegrity();
  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          files: result.files.length,
          consumers: result.consumers.length,
          declared: result.declarationOrigins.size,
          reasonCoded: result.reasonCoded,
          unresolved: result.unresolved,
        },
        null,
        2,
      ),
    );
  } else printReport(result);
  if (result.unresolved.length > 0) process.exitCode = 1;
}
