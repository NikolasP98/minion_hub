import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { validateMessage } from './eval-adapter.mjs';
const frame = (type, payload = {}) => ({ version: 1, id: 'command-1', type, payload });
const reset = {
  episodeId: 'fixture-1',
  arm: 'full',
  seed: 7,
  persona: 'owner',
  initialState: 'empty',
  locale: 'en',
  model: { requestedModel: 'fixture/main', boundDescriptor: 'fixture/bounded-v1' },
};
test('fixed protocol rejects unknown source, URL, selector, command and malformed transitions', () => {
  for (const value of [
    frame('evaluate', { source: 'return true' }),
    frame('turn', { text: 'hi', url: 'https://invalid' }),
    frame('transition', { action: 'page', page: 'https://invalid' }),
    frame('transition', { action: 'owner', actor: 'a', org: 'c' }),
    frame('reset', { ...reset, initialState: 'arbitrary' }),
    frame('reset', { ...reset, model: { requestedModel: 'secret\nkey', boundDescriptor: 'x' } }),
  ])
    assert.throws(() => validateMessage(value));
  assert.deepEqual(validateMessage(frame('reset', reset)), frame('reset', reset));
});
test('provider records preserve data but reject invalid receipt identities, usage and unknown controls', () => {
  assert.doesNotThrow(() =>
    validateMessage(
      frame('provider_result', {
        requestId: 'provider-1',
        result: { answers: { mode: { choice: 'chat' } } },
        requestedModel: '~typesafe/jev-latest',
        resolvedModel: null,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: null, costStatus: 'unknown' },
      }),
    ),
  );
  for (const payload of [
    { requestId: 'p', execute: 'echo unsafe' },
    { requestId: 'p', ack: 'invented' },
    { requestId: 'p', usage: { costUsd: -1 } },
    { requestId: 'p', resolvedModel: 'unbounded value\n' },
  ])
    assert.throws(() => validateMessage(frame('provider_result', payload)));
});
test('actual subprocess rejects pre-handshake commands, emits JSONL only, and exits on stdin death without a build', async () => {
  const child = spawn(
    process.execPath,
    [new URL('./eval-adapter.mjs', import.meta.url).pathname, '--stdio'],
    { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdin.end(JSON.stringify(frame('collect')) + '\n');
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  assert.equal(code, 0, stderr);
  const records = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'error');
  assert.match(records[0].payload.message, /Handshake required/);
});

test('typed artifact transport preserves actual ChatBlocks toolCall input and rejects other executable tool names', async () => {
  const { validateMainResult } = await import('./eval-adapter.mjs');
  const message = {
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: 'artifact-fixture',
        name: 'chat_artifact',
        arguments: {
          html: '',
          buttons: [{ text: 'Artifact fixture', callback_data: 'FIXTURE_CALLBACK' }],
        },
      },
    ],
  };
  assert.deepEqual(validateMainResult({ message }), { message });
  for (const invalid of [
    { message: { role: 'user', content: [] } },
    {
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call',
            name: 'arbitrary_command',
            arguments: { command: 'unsafe' },
          },
        ],
      },
    },
    { message: { role: 'assistant', content: [{ type: 'script', source: 'unsafe' }] } },
  ])
    assert.throws(() => validateMainResult(invalid));
});
