#!/usr/bin/env node

import {
  auditTokenSources as auditSharedTokenSources,
  extractVarConsumers,
  formatTokenAuditReport,
  scanTokenIntegrity as scanSharedTokenIntegrity,
} from '@minion-stack/design-tokens/audit';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDir, '..');

/** Retired Hub names whose return would split it from the shared semantic contract. */
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

const COMPONENT_INPUTS = new Map([
  ['src/lib/components/builder/ChapterDAG.svelte\0--color-dag-bg', 'chapter DAG surface override'],
  [
    'src/lib/components/data-table/DataTable.svelte\0--dt-agg-color',
    'aggregate label colour override',
  ],
  [
    'src/lib/components/channels/WhatsAppQrPairing.svelte\0--color-qr-canvas',
    'QR contrast canvas override',
  ],
  [
    'src/lib/components/channels/WhatsAppQrPairing.svelte\0--color-qr-ink-muted',
    'QR instruction ink override',
  ],
  [
    'src/lib/components/scheduling/BookingCalendar.svelte\0--evt-c',
    'per-event colour from the picked select column (fallback required)',
  ],
]);

const THIRD_PARTY_RUNTIME_INPUTS = new Map([
  ['src/lib/components/layout/ToastItem.svelte\0--y', 'Zag toast positioning'],
  ['src/lib/components/layout/ToastItem.svelte\0--opacity', 'Zag toast visibility'],
  ['src/lib/components/layout/ToastItem.svelte\0--z-index', 'Zag toast stacking'],
  ['src/lib/components/layout/ToastItem.svelte\0--height', 'Zag toast presence animation'],
  [
    'src/lib/components/ui/Popover.svelte\0--available-width',
    'Zag popover available viewport width',
  ],
  [
    'src/lib/components/ui/Popover.svelte\0--available-height',
    'Zag popover available viewport height',
  ],
]);

const THIRD_PARTY_PREFIXES = ['--tw-', '--xy-'];

function hubExceptionFor(consumer) {
  const key = `${consumer.file}\0${consumer.token}`;
  if (consumer.dynamicTemplate)
    return { reason: 'runtime-template', detail: 'computed token name' };
  if (THIRD_PARTY_RUNTIME_INPUTS.has(key) && consumer.hasFallback) {
    return { reason: 'third-party-runtime', detail: THIRD_PARTY_RUNTIME_INPUTS.get(key) };
  }
  if (THIRD_PARTY_PREFIXES.some((prefix) => consumer.token.startsWith(prefix))) {
    return { reason: 'third-party-contract', detail: 'framework-owned custom property' };
  }
  if (
    consumer.file.startsWith('src/lib/artifacts/builtin/') &&
    consumer.token === '--radius' &&
    consumer.hasFallback
  ) {
    return { reason: 'render-surface', detail: 'artifact host token with standalone fallback' };
  }
  if (COMPONENT_INPUTS.has(key) && consumer.hasFallback) {
    return { reason: 'component-input', detail: COMPONENT_INPUTS.get(key) };
  }
  return null;
}

export { extractVarConsumers };

export function auditTokenSources(options) {
  return auditSharedTokenSources({
    ...options,
    forbiddenTokens: options.forbiddenTokens ?? FORBIDDEN_LEGACY_TOKENS,
    exceptionFor: options.exceptionFor ?? hubExceptionFor,
  });
}

export function scanTokenIntegrity({
  rootDir = defaultRoot,
  sourceDirs = ['src', 'static'],
  ...options
} = {}) {
  return scanSharedTokenIntegrity({
    ...options,
    rootDir,
    sourceDirs,
    ignoredDirectoryNames: options.ignoredDirectoryNames ?? ['node_modules', 'paraglide'],
    forbiddenTokens: options.forbiddenTokens ?? FORBIDDEN_LEGACY_TOKENS,
    exceptionFor: options.exceptionFor ?? hubExceptionFor,
  });
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const result = scanTokenIntegrity();
    if (process.argv.includes('--json')) {
      console.log(
        JSON.stringify(
          {
            files: result.files.length,
            consumers: result.consumers.length,
            declared: result.declarationOrigins.size,
            packageVersion: result.shared.packageVersion,
            reasonCoded: result.reasonCoded,
            unresolved: result.unresolved,
          },
          null,
          2,
        ),
      );
    } else process.stdout.write(formatTokenAuditReport(result));
    if (result.unresolved.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(
      `token-integrity failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
