/** Fresh real JSONL adapter/browser compilation. Run only in the allocated heavy lane. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as pause } from 'node:timers/promises';

test(
  'real stdio provider requests retain two turns and canonical compaction',
  { timeout: 300000 },
  async () => {
    const child = spawn(
      process.execPath,
      [new URL('./eval-adapter.mjs', import.meta.url).pathname, '--stdio'],
      {
        env: {
          PATH: process.env.PATH,
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const lines = createInterface({ input: child.stdout });
    const pending = new Map();
    const providers = [];
    let serial = 0,
      diagnostic = '',
      exited = false;
    const exit = new Promise((resolve) =>
      child.once('exit', (code) => {
        exited = true;
        resolve(code);
      }),
    );
    child.stderr.on('data', (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-16384);
    });
    lines.on('line', (line) => {
      const frame = JSON.parse(line);
      if (frame.type === 'provider_request') providers.push(frame.payload);
      else {
        const waiter = pending.get(frame.id);
        pending.delete(frame.id);
        if (frame.type === 'error') waiter?.reject(Error(frame.payload.message));
        else waiter?.resolve(frame.payload);
      }
    });
    child.on('error', (error) => {
      for (const waiter of pending.values()) waiter.reject(error);
    });
    child.on('exit', () => {
      for (const waiter of pending.values()) waiter.reject(Error('Adapter exited: ' + diagnostic));
    });
    function command(type, payload = {}) {
      const id = 'history-' + ++serial;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => {
            pending.delete(id);
            reject(Error('Adapter command timed out: ' + type));
          },
          type === 'hello' ? 240000 : 15000,
        );
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        child.stdin.write(JSON.stringify({ version: 1, id, type, payload }) + '\n');
      });
    }
    async function turn(text) {
      await command('turn', { text });
      for (let attempt = 0; attempt < 200 && !providers.length; attempt++) await pause(25);
      assert.equal(providers.length, 1, 'one actual main provider request');
      const request = providers.shift();
      assert.equal(request.kind, 'main');
      assert.equal(request.messages.at(-1).content, request.message);
      assert.equal(
        request.messages.filter((message) => message.content === request.message).length,
        1,
      );
      return request;
    }
    async function answer(request, text) {
      await command('provider_result', {
        requestId: request.requestId,
        result: { text },
        requestedModel: 'fixture/main',
        resolvedModel: 'fixture/main',
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, costStatus: 'known' },
      });
      let collected;
      for (let attempt = 0; attempt < 100; attempt++) {
        collected = await command('collect');
        if (!collected.incomplete && !collected.chat.streaming) break;
        await pause(25);
      }
      assert.equal(collected.incomplete, false);
      assert.equal(collected.chat.streaming, false);
      assert.equal(collected.network.externalRequests, 0);
      assert.deepEqual(collected.violations, []);
      return collected;
    }
    try {
      const identity = await command('hello', { protocol: 'minion-agent-eval-fixture/v1' });
      assert(identity.features.includes('provider_history'));
      await command('reset', {
        episodeId: 'stdio-history',
        arm: 'full',
        seed: 7,
        persona: 'owner',
        initialState: 'empty',
        locale: 'en',
        surface: 'home',
        sandbox: false,
        allowedTools: [],
        model: { requestedModel: 'fixture/main', boundDescriptor: 'fixture/bounded-v1' },
      });
      const first = await turn('My fixture color is blue.');
      assert.equal(first.messages.length, 1);
      await answer(first, 'Remembered blue.');
      const second = await turn('Which color did I name?');
      assert.deepEqual(
        second.messages.map((message) => message.role),
        ['user', 'assistant', 'user'],
      );
      assert.equal(second.messages[0].content, first.message);
      assert.equal(second.messages[1].content, 'Remembered blue.');
      await answer(second, 'Blue.');
      await command('transition', { action: 'compaction' });
      const third = await turn('Continue after compaction.');
      assert.deepEqual(
        third.messages.map((message) => message.role),
        ['system', 'user', 'assistant', 'user'],
      );
      assert.equal(third.messages[0].content, 'Disposable server history compaction fixture.');
      assert.equal(third.messages[1].content, second.message);
      assert.equal(third.messages[2].content, 'Blue.');
      const final = await answer(third, 'The retained color is blue.');
      assert.deepEqual(final.receipts, []);
      console.log(
        JSON.stringify({
          sourceHash: identity.sourceHash,
          buildHash: identity.buildHash,
          evidenceRoot: identity.evidenceRoot,
          syntheticProviderAttempts: 3,
          externalRequests: 0,
        }),
      );
      await command('close');
      child.stdin.end();
      assert.equal(await exit, 0, diagnostic);
    } finally {
      if (!exited) {
        child.stdin.end();
        await Promise.race([exit, pause(5000)]);
        if (!exited) {
          child.kill('SIGTERM');
          await exit;
        }
      }
      lines.close();
    }
  },
);
