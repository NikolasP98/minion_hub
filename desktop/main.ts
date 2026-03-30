/**
 * Electrobun desktop main process.
 * Starts the SvelteKit adapter-node server on port 5959 (D-01)
 * and opens a BrowserWindow pointing at it (D-04).
 */
import { createServer } from 'node:http';
import { BrowserWindow, ApplicationMenu } from 'electrobun/bun';
import Electrobun from 'electrobun/bun';

const PORT = 5959;

// Start the embedded SvelteKit server (D-03: node:http, not Bun.serve)
// adapter-node build output is at ../build/handler.js relative to this file
const { handler } = await import('../build/handler.js');
const server = createServer(handler);

await new Promise<void>((resolve, reject) => {
  server.on('error', reject);
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[desktop] SvelteKit server listening on http://127.0.0.1:${PORT}`);
    resolve();
  });
});

// Open BrowserWindow (D-04: load via HTTP, not views://)
const win = new BrowserWindow({
  title: 'Minion Hub',
  url: `http://127.0.0.1:${PORT}`,
  frame: { width: 1400, height: 900 },
  titleBarStyle: 'hiddenInset',
});

// Application menu with standard Edit + View entries
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

// Clean shutdown: close HTTP server when the app quits (D-02: exitOnLastWindowClosed in config)
Electrobun.events.on('before-quit', async () => {
  server.close();
});
