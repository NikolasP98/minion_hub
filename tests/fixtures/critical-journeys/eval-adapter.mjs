#!/usr/bin/env node
/** Disposable test driver. Input is a fixed protocol, never executable source. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import readline from 'node:readline';
export const PROTOCOL = 'minion-agent-eval-fixture/v1';
const hub = fileURLToPath(new URL('../../../', import.meta.url));
const adapter = fileURLToPath(import.meta.url);
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const token = (v) => typeof v === 'string' && /^[A-Za-z0-9_.:/~+-]{1,160}$/.test(v);
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const fields = {
  hello: ['protocol', 'sourceHash', 'lockHash', 'adapterHash'],
  reset: [
    'episodeId',
    'arm',
    'seed',
    'persona',
    'initialState',
    'initialStateHash',
    'locale',
    'surface',
    'sandbox',
    'revisions',
    'allowedTools',
    'model',
  ],
  turn: ['text', 'origin'],
  provider_result: [
    'requestId',
    'result',
    'error',
    'ack',
    'duplicateFinal',
    'requestedModel',
    'resolvedModel',
    'usage',
  ],
  transition: ['action', 'actor', 'org', 'page', 'session', 'fail', 'hold', 'index', 'order'],
  cancel: [],
  collect: [],
  close: [],
};
export function validateMessage(input) {
  if (
    !exact(input, ['version', 'id', 'type', 'payload']) ||
    input.version !== 1 ||
    !token(input.id) ||
    !Object.hasOwn(fields, input.type) ||
    !exact(input.payload, fields[input.type])
  )
    throw Error('Invalid protocol record');
  const p = input.payload;
  if (
    input.type === 'hello' &&
    Object.entries(p).some(([k, v]) => (k === 'protocol' ? v !== PROTOCOL : !hash(v)))
  )
    throw Error('Invalid handshake');
  if (input.type === 'reset') {
    if (
      !token(p.episodeId) ||
      !['full', 'jev', 'core_discovery'].includes(p.arm) ||
      !Number.isSafeInteger(p.seed) ||
      !['owner', 'reader'].includes(p.persona) ||
      !['empty', 'one-element'].includes(p.initialState) ||
      !['en', 'es'].includes(p.locale) ||
      !exact(p.model, ['requestedModel', 'boundDescriptor']) ||
      !token(p.model.requestedModel) ||
      !token(p.model.boundDescriptor)
    )
      throw Error('Invalid reset');
    if (p.surface !== undefined && !['home', 'floating'].includes(p.surface))
      throw Error('Invalid surface');
    if (p.sandbox !== undefined && typeof p.sandbox !== 'boolean') throw Error('Invalid sandbox');
    if (p.initialStateHash !== undefined && !hash(p.initialStateHash))
      throw Error('Invalid state hash');
    if (
      p.revisions !== undefined &&
      (!object(p.revisions) ||
        Object.keys(p.revisions).length > 12 ||
        Object.entries(p.revisions).some(([k, v]) => !token(k) || !hash(v)))
    )
      throw Error('Invalid revisions');
    if (
      p.allowedTools !== undefined &&
      (!Array.isArray(p.allowedTools) ||
        p.allowedTools.length > 32 ||
        p.allowedTools.some((v) => !token(v)))
    )
      throw Error('Invalid tool allowlist');
  }
  if (
    input.type === 'turn' &&
    (typeof p.text !== 'string' ||
      !p.text.trim() ||
      Buffer.byteLength(p.text) > 16384 ||
      (p.origin !== undefined && p.origin !== 'user'))
  )
    throw Error('Invalid user turn');
  if (input.type === 'provider_result') {
    if (
      !token(p.requestId) ||
      (p.ack !== undefined && !['before', 'after', 'missing'].includes(p.ack)) ||
      (p.duplicateFinal !== undefined && typeof p.duplicateFinal !== 'boolean') ||
      (p.error !== undefined && !['timeout', 'transport', 'invalid'].includes(p.error))
    )
      throw Error('Invalid provider result');
    if (
      (p.requestedModel !== undefined && !token(p.requestedModel)) ||
      (p.resolvedModel !== undefined && p.resolvedModel !== null && !token(p.resolvedModel))
    )
      throw Error('Invalid provider identity');
    if (
      p.usage !== undefined &&
      (!exact(p.usage, ['inputTokens', 'outputTokens', 'costUsd', 'costStatus']) ||
        Object.entries(p.usage).some(([k, v]) =>
          k === 'costStatus'
            ? !['known', 'unknown'].includes(v)
            : k === 'costUsd'
              ? v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)
              : !Number.isSafeInteger(v) || v < 0,
        ))
    )
      throw Error('Invalid usage');
    if (
      p.usage !== undefined &&
      !(
        (p.usage.costStatus === 'unknown' && p.usage.costUsd === null) ||
        (p.usage.costStatus === 'known' && typeof p.usage.costUsd === 'number')
      )
    )
      throw Error('Inconsistent usage cost');
  }
  if (input.type === 'transition') {
    const shapes = {
      owner: ['action', 'actor', 'org'],
      page: ['action', 'page'],
      session: ['action', 'session'],
      release_reload: ['action', 'fail', 'order'],
      hold_reload: ['action', 'hold'],
      window_reload: ['action'],
      duplicate_final: ['action'],
      history_reload: ['action'],
      registry_change: ['action'],
      choice: ['action', 'index'],
      artifact: ['action', 'index'],
      compaction: ['action'],
    };
    if (!Object.hasOwn(shapes, p.action) || !exact(p, shapes[p.action]))
      throw Error('Invalid transition');
    if (
      (p.action === 'owner' && (!['a', 'b'].includes(p.actor) || !['a', 'b'].includes(p.org))) ||
      (p.action === 'page' && !['home', 'sandbox', 'crm'].includes(p.page)) ||
      (p.action === 'session' && !['main', 'other'].includes(p.session)) ||
      (['choice', 'artifact'].includes(p.action) &&
        (!Number.isSafeInteger(p.index) || p.index < 0 || p.index > 19)) ||
      (p.action === 'hold_reload' && typeof p.hold !== 'boolean') ||
      (p.action === 'release_reload' &&
        ((p.fail !== undefined && typeof p.fail !== 'boolean') ||
          (p.order !== undefined && !['oldest', 'latest'].includes(p.order))))
    )
      throw Error('Invalid transition payload');
  }
  return input;
}
/** Transport shape only: the actual ChatBlocks parser interprets artifact arguments. */
export function validateMainResult(value) {
  if (!object(value) || value.message === undefined) return value;
  const message = value.message;
  if (
    !exact(message, ['role', 'content']) ||
    message.role !== 'assistant' ||
    !Array.isArray(message.content) ||
    message.content.length > 8
  )
    throw Error('Invalid assistant fixture message');
  for (const block of message.content) {
    if (block?.type === 'text') {
      if (
        !exact(block, ['type', 'text']) ||
        typeof block.text !== 'string' ||
        block.text.length > 16384
      )
        throw Error('Invalid assistant text block');
    } else if (block?.type === 'toolCall') {
      if (
        !exact(block, ['type', 'id', 'name', 'arguments']) ||
        !token(block.id) ||
        block.name !== 'chat_artifact' ||
        !Object.hasOwn(block, 'arguments')
      )
        throw Error('Unregistered assistant fixture tool call');
    } else throw Error('Invalid assistant fixture block');
  }
  return value;
}
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runStdio() {
  if (fs.realpathSync(hub) !== path.resolve(hub)) throw Error('Linked Hub checkout denied');
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-agent-eval-'));
  fs.chmodSync(runRoot, 0o700);
  const evidence = path.join(runRoot, 'evidence'),
    output = path.join(runRoot, 'build');
  fs.mkdirSync(evidence, { mode: 0o700 });
  const cleanEnv = {
    PATH: process.env.PATH,
    HOME: runRoot,
    TMPDIR: runRoot,
    CI: '1',
    NODE_OPTIONS: '--max-old-space-size=1536',
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH
      ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
      : {}),
  };
  let browser,
    context,
    page,
    server,
    identity,
    classify,
    pump,
    reset,
    closed = false,
    handshaken = false,
    canceled = false,
    prepared = false;
  const ownedChildren = new Set();
  const active = new Map(),
    seen = new Map(),
    network = [],
    inference = [];
  const log = (file) => path.join(evidence, file);
  const append = (file, value) =>
    fs.appendFileSync(log(file), JSON.stringify(value) + '\n', { mode: 0o600 });
  const childRun = (script, env) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd: hub,
        env: { ...cleanEnv, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      ownedChildren.add(child);
      const fd = fs.createWriteStream(log('build.log'), { flags: 'a', mode: 0o600 });
      child.stdout.pipe(fd, { end: false });
      child.stderr.pipe(fd, { end: false });
      child.once('error', reject);
      child.once('close', (code) => {
        ownedChildren.delete(child);
        fd.end();
        code === 0 ? resolve() : reject(Error('Fixture build failed'));
      });
    });
  async function prepare() {
    if (prepared) return;
    if (identity) throw Error('A previous runtime preparation failed');
    await childRun('tests/fixtures/critical-journeys/build.mjs', {
      MINION_CRITICAL_OUT: output,
      MINION_CRITICAL_EVIDENCE: evidence,
      MINION_CRITICAL_EVAL_ONLY: '1',
    });
    const { build } = await import('vite');
    const fixture = path.join(hub, 'tests/fixtures/critical-journeys');
    await build({
      configFile: false,
      envDir: false,
      root: hub,
      logLevel: 'silent',
      resolve: {
        alias: {
          $lib: path.join(hub, 'src/lib'),
          '$env/dynamic/public': path.join(
            hub,
            'tests/fixtures/mobile-composition/stubs/env-public.js',
          ),
        },
      },
      build: {
        ssr: true,
        outDir: path.join(runRoot, 'classifier'),
        rollupOptions: {
          input: path.join(hub, 'src/server/services/assistant-router.service.ts'),
          output: { entryFileNames: 'entry.mjs' },
        },
      },
    });
    const classifierFile = path.join(runRoot, 'classifier/entry.mjs');
    classify = (await import(pathToFileURL(classifierFile))).classifyAssistantTurnWithEvidence;
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    const sourcePaths = [
      ...new Set(
        manifest.modules
          .filter(
            (file) =>
              file.startsWith(hub) &&
              !file.includes('/node_modules/') &&
              fs.existsSync(file) &&
              fs.statSync(file).isFile(),
          )
          .concat([adapter, path.join(hub, 'src/server/services/assistant-router.service.ts')]),
      ),
    ].sort();
    const sources = sourcePaths.map((file) => ({
      path: path.relative(hub, file),
      sha256: sha(fs.readFileSync(file)),
    }));
    identity = {
      protocol: PROTOCOL,
      sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hub, encoding: 'utf8' }).trim(),
      sourceHash: sha(JSON.stringify(sources)),
      lockHash: sha(fs.readFileSync(path.join(hub, 'bun.lock'))),
      buildHash: sha(JSON.stringify(manifest) + sha(fs.readFileSync(classifierFile))),
      adapterHash: sha(fs.readFileSync(adapter)),
      disposable: true,
      evidenceRoot: evidence,
      features: [
        'home',
        'floating',
        'three_arms',
        'provider_history',
        'session_scoped_compaction',
        'accepted_run',
        'sandbox_handoff',
        'independent_domain_receipts',
        'provider_receipts',
      ],
      sources,
    };
    fs.writeFileSync(log('identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
    server = spawn(process.execPath, ['tests/fixtures/critical-journeys/serve.mjs'], {
      cwd: hub,
      env: {
        ...cleanEnv,
        MINION_CRITICAL_OUT: output,
        MINION_CRITICAL_RUN_ID: path.basename(runRoot),
        MINION_CRITICAL_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const port = await new Promise((resolve, reject) => {
      let data = '';
      const timer = setTimeout(() => reject(Error('Fixture server readiness timeout')), 10000);
      server.stdout.on('data', (chunk) => {
        data += chunk;
        try {
          const value = JSON.parse(data.trim());
          if (value.fixturePort) {
            clearTimeout(timer);
            resolve(value.fixturePort);
          }
        } catch {}
      });
      server.once('error', reject);
      server.once('exit', () => reject(Error('Fixture server died')));
    });
    identity.origin = `http://127.0.0.1:${port}`;
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, env: cleanEnv });
    prepared = true;
  }
  async function dispose() {
    closed = true;
    clearInterval(pump);
    for (const task of active.values()) task.reject?.(Error('Adapter closed'));
    active.clear();
    for (const child of ownedChildren) if (child.exitCode === null) child.kill('SIGTERM');
    await context?.close();
    await browser?.close();
    if (server && server.exitCode === null) server.kill('SIGTERM');
  }
  const terminate = () => {
    void dispose().finally(() => process.exit(0));
  };
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);
  async function pumpProviders() {
    if (!page || closed) return;
    const pending = await page.evaluate(() => window.__eval.takeProviders());
    for (const request of pending) {
      if (canceled) {
        append('diagnostics.jsonl', {
          kind: 'inference_after_cancel_denied',
          requestId: request.requestId,
        });
        continue;
      }
      if (inference.length + active.size >= 64) throw Error('Episode inference capacity exceeded');
      if (request.kind === 'classifier') {
        const task = { request, resolve: null, reject: null };
        active.set(request.requestId, task);
        const result = classify(
          { ...request.input, submissionId: request.submissionId },
          {
            apiKey: 'fixture-only-noncredential',
            fetcher: async (_url, init) => {
              const actual = JSON.parse(init.body);
              send({
                version: 1,
                id: request.requestId,
                type: 'provider_request',
                payload: {
                  requestId: request.requestId,
                  kind: 'classifier',
                  ...actual,
                  boundDescriptor: 'decisions/v1',
                },
              });
              task.request.model = actual.model;
              const provider = await new Promise((resolve, reject) => {
                task.resolve = resolve;
                task.reject = reject;
              });
              if (provider.error)
                throw new DOMException(
                  'fixture transport',
                  provider.error === 'timeout' ? 'TimeoutError' : 'AbortError',
                );
              return Response.json(provider.result ?? null);
            },
          },
        );
        task.result = result.then(async (value) => {
          if (page && active.has(request.requestId))
            await page.evaluate(({ id, value }) => window.__eval.resolveProvider(id, value), {
              id: request.requestId,
              value,
            });
          active.delete(request.requestId);
        });
        task.result.catch((error) =>
          append('diagnostics.jsonl', { kind: 'classifier_error', name: error.name }),
        );
      } else {
        active.set(request.requestId, { request });
        send({ version: 1, id: request.requestId, type: 'provider_request', payload: request });
      }
    }
  }
  async function execute(message) {
    const p = message.payload;
    if (message.type === 'hello') {
      if (handshaken) throw Error('Handshake already completed');
      await prepare();
      for (const key of ['sourceHash', 'lockHash', 'adapterHash'])
        if (p[key] && p[key] !== identity[key]) throw Error('Handshake identity mismatch');
      handshaken = true;
      return identity;
    }
    if (closed) throw Error('Adapter closed');
    if (!handshaken) throw Error('Handshake required');
    if (message.type === 'reset') {
      clearInterval(pump);
      for (const task of active.values()) task.reject?.(Error('Episode reset'));
      active.clear();
      await context?.close();
      reset = p;
      canceled = false;
      network.length = 0;
      inference.length = 0;
      context = await browser.newContext({
        locale: p.locale,
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block',
      });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin === identity.origin && ['GET', 'HEAD'].includes(route.request().method()))
          route.continue();
        else {
          network.push({
            url: url.origin,
            method: route.request().method(),
            disposition: 'denied',
          });
          route.abort('blockedbyclient');
        }
      });
      await context.addInitScript((value) => {
        window.__evalBootstrap = value;
      }, p);
      page = await context.newPage();
      await page.goto(identity.origin + '/eval.html');
      await page.waitForFunction(() => window.__eval && window.__critical.snapshot().connected);
      await page.getByRole('textbox').first().waitFor({ state: 'visible' });
      if (p.sandbox)
        await page.waitForFunction(() =>
          window.__eval.collect().then((value) => value.tools.includes('sandbox.upsert_element')),
        );
      const initial = await page.evaluate(() => window.__eval.initialState());
      const initialStateHash = sha(JSON.stringify(initial));
      if (p.initialStateHash && p.initialStateHash !== initialStateHash)
        throw Error('Initial state hash mismatch');
      append('resets.jsonl', { ...p, initialStateHash });
      pump = setInterval(
        () =>
          void pumpProviders().catch((error) =>
            append('diagnostics.jsonl', { kind: 'pump_error', name: error.name }),
          ),
        20,
      );
      return {
        initialStateHash,
        episodeId: p.episodeId,
        arm: p.arm,
        revisions: p.revisions ?? {},
        identity: { sourceHash: identity.sourceHash, buildHash: identity.buildHash },
      };
    }
    if (message.type === 'close') {
      await dispose();
      return { closed: true, evidenceRoot: evidence };
    }
    if (!reset || !page) throw Error('Reset required');
    if (message.type === 'turn') {
      if (canceled) throw Error('Episode was canceled; reset required');
      if (active.size) throw Error('Outstanding provider request');
      const input = page.getByRole('textbox').first();
      await input.fill(p.text);
      await input.press('Enter');
      return { submittedIntent: true };
    }
    if (message.type === 'provider_result') {
      const task = active.get(p.requestId);
      if (!task) throw Error('Unknown or settled provider request');
      if (task.request.kind === 'main') validateMainResult(p.result);
      if (
        task.request.kind === 'main' &&
        p.requestedModel !== undefined &&
        p.requestedModel !== task.request.model
      )
        throw Error('Provider model drift');
      const receipt = {
        requestId: p.requestId,
        kind: task.request.kind,
        requestedModel: p.requestedModel ?? task.request.model ?? null,
        resolvedModel: p.resolvedModel ?? null,
        usage: p.usage ?? null,
        coverage: p.requestedModel && p.usage ? 'provided' : 'missing_provider_receipt',
      };
      inference.push(receipt);
      append('inference.jsonl', receipt);
      if (task.request.kind === 'classifier') {
        if (!task.resolve) throw Error('Classifier request not ready');
        task.resolve(p);
        await task.result;
      } else {
        active.delete(p.requestId);
        await page.evaluate(
          (p) =>
            window.__eval.resolveProvider(p.requestId, p.result, {
              ack: p.ack,
              duplicateFinal: p.duplicateFinal,
              error: p.error,
            }),
          p,
        );
      }
      return { received: true, receipt };
    }
    if (message.type === 'transition') {
      if (p.action === 'choice' || p.action === 'artifact') {
        const choices = page.locator(
          p.action === 'choice'
            ? '[data-assist="assistant.choice"] button'
            : '.artifact-buttons button',
        );
        if ((await choices.count()) <= p.index) throw Error('No exact live callback control');
        await choices.nth(p.index).click();
      } else await page.evaluate((value) => window.__eval.transition(value), p);
      await pause(30);
      return { transitioned: true };
    }
    if (message.type === 'cancel') {
      canceled = true;
      for (const task of active.values()) task.reject?.(new DOMException('canceled', 'AbortError'));
      active.clear();
      const stop = page.getByRole('button', { name: /^(?:Stop|Detener)/i });
      if (await stop.count()) await stop.first().click();
      await pause(30);
      return { canceled: true };
    }
    if (message.type === 'collect') {
      await pause(50);
      const collected = await page.evaluate(() => window.__eval.collect());
      const value = {
        ...collected,
        inference,
        network: {
          externalRequests: network.length,
          violations: network,
          boundary: 'owned-loopback-only',
        },
        identity,
        episodeId: reset.episodeId,
        arm: reset.arm,
        incomplete:
          active.size > 0 ||
          collected.pendingProviders > 0 ||
          collected.pendingUiRuns > 0 ||
          collected.pendingReloads > 0 ||
          collected.violations.length > 0 ||
          network.length > 0 ||
          inference.some((receipt) => receipt.coverage !== 'provided'),
      };
      append('collections.jsonl', value);
      return value;
    }
    throw Error('Unsupported command');
  }
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();
  lines.on('line', (line) => {
    chain = chain.then(async () => {
      let value;
      try {
        if (Buffer.byteLength(line) > 65536) throw Error('Protocol payload too large');
        value = validateMessage(JSON.parse(line));
        const fingerprint = sha(line);
        const prior = seen.get(value.id);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw Error('Conflicting command ID');
          send(prior.response);
          return;
        }
        if (seen.size >= 2048) throw Error('Command capacity exceeded');
        const payload = await execute(value);
        const response = { version: 1, id: value.id, type: 'result', payload };
        seen.set(value.id, { fingerprint, response });
        send(response);
        if (value.type === 'close') lines.close();
      } catch (error) {
        const response = {
          version: 1,
          id: token(value?.id) ? value.id : 'invalid',
          type: 'error',
          payload: {
            code: 'FIXTURE_PROTOCOL',
            message: error instanceof Error ? error.message : 'Protocol failure',
          },
        };
        send(response);
        append('errors.jsonl', response);
        if (value?.type === 'hello') await dispose();
      }
    });
  });
  await new Promise((resolve) => lines.once('close', resolve));
  await chain;
  await dispose();
}
if (process.argv[1] && path.resolve(process.argv[1]) === adapter) {
  if (process.argv.length !== 3 || process.argv[2] !== '--stdio') throw Error('Use --stdio');
  await runStdio();
}
