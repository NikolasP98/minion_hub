import { mount } from 'svelte';
import Fixture from './Fixture.svelte';
import '../../../src/app.css';

const requests: { path: string; method: string; body: unknown }[] = [];
const failures: string[] = [];
Object.assign(window, { __buttonEvidence: { requests, failures } });
window.addEventListener('error', (event) => failures.push(event.message));
window.addEventListener('unhandledrejection', (event) => failures.push(String(event.reason)));
window.fetch = async (input, init) => {
  const path = String(input);
  if (path !== '/api/flows/flow%2F%252F%2F%E6%9D%B1%E4%BA%AC/exports' || init?.method !== 'PATCH') {
    failures.push('Unexpected fetch ' + path);
    throw new Error('Fixture forbids external requests');
  }
  requests.push({ path, method: init.method, body: JSON.parse(String(init.body)) });
  const output = document.getElementById('requests');
  if (output) output.textContent = JSON.stringify(requests, null, 2);
  return Response.json({ ok: true });
};
mount(Fixture, { target: document.getElementById('app')! });
