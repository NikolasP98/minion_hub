/**
 * Electrobun desktop main process.
 * Opens a BrowserWindow pointing at the SvelteKit server
 * (started separately by desktop/launch.sh).
 */
import { BrowserWindow, ApplicationMenu } from 'electrobun/bun';

const PORT = 5959;

console.log('[desktop] Worker started');

const win = new BrowserWindow({
  title: 'Minion Hub',
  url: `http://127.0.0.1:${PORT}`,
  frame: { width: 1400, height: 900 },
  partition: 'persist:minionhub',
});

ApplicationMenu.setApplicationMenu([
  { submenu: [{ label: 'Quit Minion Hub', role: 'quit' }] },
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
  { label: 'View', submenu: [{ role: 'toggleFullScreen' }] },
]);
