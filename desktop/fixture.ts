// Development-only actual-component fixture. Not an entry in desktop:ui output.
import { mount } from 'svelte';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import Updater from '../src/lib/components/desktop-updater/Updater.svelte';
import './style.css';

let status = {
  revision: 0,
  phase: 'checking',
  version: null as string | null,
  percent: null as number | null,
  manual: false,
  installerUrl: null as string | null,
};
const calls: string[] = [];
mockIPC(
  (command) => {
    calls.push(command);
    if (command === 'desktop_update_status') return status;
    if (command === 'desktop_update_check') return send({ phase: 'checking' });
    if (command === 'desktop_update_install') return send({ phase: 'downloading', percent: 0 });
  },
  { shouldMockEvents: true },
);
async function send(next: Partial<typeof status>) {
  status = { ...status, ...next, revision: status.revision + 1 };
  await emit('desktop-update', status);
}
Object.assign(window, { updaterFixture: { send, calls } });
mount(Updater, { target: document.getElementById('app')! });
