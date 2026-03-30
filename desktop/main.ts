/**
 * Electrobun desktop main process.
 * Spawns the SvelteKit adapter-node server on port 5959
 * and opens a BrowserWindow pointing at it.
 *
 * No top-level await — Electrobun's GTK/native event loop
 * must not be blocked by async operations.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { BrowserWindow, ApplicationMenu } from 'electrobun/bun';
import Electrobun from 'electrobun/bun';

const PORT = 5959;

// Find the project root by walking up from the Electrobun binary.
// Electrobun runs from: <project>/build/dev-<platform>/<AppName>/bin/bun
function findProjectRoot(): string {
  const binDir = process.argv[0] ? join(process.argv[0], '..') : process.cwd();
  let dir = binDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'build', 'handler.js'))) {
      return dir;
    }
    dir = join(dir, '..');
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();
const serverEntry = join(projectRoot, 'build', 'index.js');

// Spawn the SvelteKit server as a child process (non-blocking).
// Runs from the project root so node_modules are resolvable.
let child: ChildProcess | null = null;
if (existsSync(serverEntry)) {
  child = spawn('node', [serverEntry], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: 'inherit',
  });
  child.on('error', (err) => console.error('[desktop] Server spawn error:', err));
} else {
  console.error(`[desktop] Server entry not found: ${serverEntry}`);
  console.error(`[desktop] Run 'bun run desktop:build' first.`);
}

// Open BrowserWindow — the page loads once the server is ready.
const win = new BrowserWindow({
  title: 'Minion Hub',
  url: `http://127.0.0.1:${PORT}`,
  frame: { width: 1400, height: 900 },
  titleBarStyle: 'hiddenInset',
});

// Application menu
ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: 'Quit Minion Hub', role: 'quit' }],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  },
  {
    label: 'View',
    submenu: [{ role: 'toggleFullScreen' }],
  },
]);

// Clean shutdown
Electrobun.events.on('before-quit', () => {
  child?.kill();
});
