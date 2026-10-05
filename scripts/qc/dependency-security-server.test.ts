import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let child: ChildProcessWithoutNullStreams | undefined;
let socket: Socket | undefined;
let artifactRoot: string | undefined;

function waitForExit(process: ChildProcessWithoutNullStreams, timeoutMs: number) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture server did not exit')), timeoutMs);
    process.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function waitForListening(process: ChildProcessWithoutNullStreams) {
  return new Promise<number>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`fixture did not listen: ${stderr}`)), 2_000);
    process.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000);
    });
    process.stdout.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-2_000);
      const match = stdout.match(/listening 127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    process.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(`fixture exited before listen: ${String(code)}/${String(signal)} ${stderr}`),
      );
    });
  });
}

function connectWithoutHttp(port: number) {
  return new Promise<Socket>((resolve, reject) => {
    const connection = createConnection({ host: '127.0.0.1', port });
    connection.once('connect', () => resolve(connection));
    connection.once('error', reject);
  });
}

function waitForSocketClose(connection: Socket, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preconnect socket did not close')), timeoutMs);
    connection.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

afterEach(async () => {
  socket?.destroy();
  socket = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = waitForExit(child, 2_000);
    child.kill('SIGKILL');
    await exited;
  }
  child = undefined;
  if (artifactRoot) rmSync(artifactRoot, { recursive: true, force: true });
  artifactRoot = undefined;
});

describe('dependency fixture server shutdown', () => {
  it('closes a native TCP preconnect that never sends an HTTP request', async () => {
    artifactRoot = mkdtempSync(join(tmpdir(), 'minion-dependency-server-'));
    const body = Buffer.from('<!doctype html><title>fixture</title>');
    writeFileSync(join(artifactRoot, 'index.html'), body, { mode: 0o600 });
    writeFileSync(
      join(artifactRoot, 'manifest.json'),
      JSON.stringify({
        files: [
          {
            path: 'index.html',
            size: body.byteLength,
            sha256: createHash('sha256').update(body).digest('hex'),
          },
        ],
      }),
      { mode: 0o600 },
    );

    child = spawn(process.execPath, ['tests/fixtures/dependency-security/serve.mjs'], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        MINION_DEPENDENCY_OUT: artifactRoot,
        MINION_DEPENDENCY_RUN_ID: randomUUID(),
        MINION_DEPENDENCY_SHUTDOWN_TEST: '1',
        MINION_DEPENDENCY_PORT: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end();
    const port = await waitForListening(child);
    socket = await connectWithoutHttp(port);
    const socketClosed = waitForSocketClose(socket, 2_000);
    const exited = waitForExit(child, 2_000);

    expect(child.kill('SIGTERM')).toBe(true);
    const [socketResult, exitResult] = await Promise.all([socketClosed, exited]);
    expect(socketResult).toBeUndefined();
    expect(exitResult).toEqual({ code: 0, signal: null });
    expect(socket.destroyed).toBe(true);
  });
});
