#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';
import { clientBuildBoundaryPlugin } from './client-build-boundary-plugin.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const scanner = path.join(scriptDirectory, 'assert-client-build-boundary.mjs');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-client-boundary-canary-'));
fs.chmodSync(temporaryRoot, 0o700);

function writeFixture(root, entry, serverModule) {
  fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'client-entry.js'), entry);
  if (serverModule) {
    fs.writeFileSync(path.join(root, 'src', 'server', 'harmless-side-effect.js'), serverModule);
  }
}

async function bundleFixture(root) {
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [clientBuildBoundaryPlugin()],
    build: {
      emptyOutDir: true,
      manifest: true,
      minify: false,
      outDir: 'dist',
      rollupOptions: { input: path.join(root, 'src', 'client-entry.js') },
      target: 'es2022',
    },
  });
}

function requireScannerRejection(root, expectedDiagnostic) {
  const result = spawnSync(process.execPath, [scanner, root], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  if (result.status === 0) {
    throw new Error(`Client boundary canary was accepted: ${expectedDiagnostic}`);
  }
  const diagnostic = `${result.stderr}\n${result.stdout}`;
  if (!diagnostic.includes(expectedDiagnostic)) {
    throw new Error(
      `Client boundary canary failed for an unexpected reason; wanted ${expectedDiagnostic}:\n${diagnostic}`,
    );
  }
}

try {
  const moduleCanaryRoot = path.join(temporaryRoot, 'module');
  writeFixture(
    moduleCanaryRoot,
    "import './server/harmless-side-effect.js';\nexport const client = true;\n",
    'globalThis.__hubServerModuleCanary = true;\n',
  );
  let moduleRejection;
  try {
    await bundleFixture(moduleCanaryRoot);
  } catch (error) {
    moduleRejection = error;
  }
  const moduleDiagnostic = moduleRejection instanceof Error ? moduleRejection.message : '';
  if (!moduleDiagnostic.includes('server source')) {
    throw new Error(
      `Real client bundle did not reject its server module for the expected reason:\n${moduleDiagnostic}`,
    );
  }

  const artifactCanaryRoot = path.join(temporaryRoot, 'artifact');
  writeFixture(
    artifactCanaryRoot,
    'globalThis.__hubCredentialCanary = "SUPABASE_SERVICE_ROLE_KEY";\n',
  );
  await bundleFixture(artifactCanaryRoot);
  requireScannerRejection(
    path.join(artifactCanaryRoot, 'dist'),
    'Supabase service-role credential',
  );

  console.log(
    JSON.stringify({
      label: 'Vite client boundary canary',
      rejectedMutations: ['real bundled server module', 'real bundled private credential marker'],
    }),
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
