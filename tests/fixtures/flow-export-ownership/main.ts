import { mount } from 'svelte';
import Fixture from './Fixture.svelte';
import '../../../src/app.css';

type Parked = { resolve: (res: Response) => void; reject: (reason: Error) => void };
const requests: { path: string; method: string; body: unknown }[] = [];
const replies: Parked[] = [];
const failures: string[] = [];
Object.assign(window, {
  __hc040: {
    requests,
    failures,
    pending: () => replies.length,
    // Settle a parked reply by request index; the harness chooses the order.
    settle: (i: number, ok: boolean) => {
      const r = replies[i];
      if (!r) throw new Error(`no parked reply ${i}`);
      ok
        ? r.resolve(Response.json({ ok: true }))
        : r.reject(new Error('synthetic late transport failure'));
    },
  },
});
window.addEventListener('error', (event) => failures.push(event.message));
window.addEventListener('unhandledrejection', (event) => failures.push(String(event.reason)));
window.fetch = (input, init) =>
  new Promise<Response>((resolve, reject) => {
    const path = String(input);
    if (!/^\/api\/flows\/[AB]\/exports$/.test(path) || init?.method !== 'PATCH') {
      failures.push('Unexpected fetch ' + path);
      reject(new Error('Fixture forbids external requests'));
      return;
    }
    requests.push({ path, method: init.method, body: JSON.parse(String(init.body)) });
    replies.push({ resolve, reject });
    const output = document.getElementById('requests');
    if (output) output.textContent = JSON.stringify(requests, null, 2);
  });
mount(Fixture, { target: document.getElementById('app')! });
