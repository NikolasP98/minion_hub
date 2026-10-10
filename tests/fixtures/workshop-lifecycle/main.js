import { mount } from 'svelte';
import './fixture.css';
import { page } from './stubs/app-state';
import * as ws from '../../../src/lib/state/workshop/workshop.svelte';
import Fixture from './Fixture.svelte';

/**
 * @typedef {{ key: string; body: unknown; settled: string | null;
 *   ok(payload?: unknown): void; fail(status?: number): void; lose(): void }} ScriptedCall
 * @typedef {{ calls: ScriptedCall[]; auto: Record<string, (call: ScriptedCall) => void>;
 *   gotos: string[]; page: typeof page; ws: typeof ws }} Harness
 */
/** Scripted transport: every request is captured; the driver settles it explicitly or via `auto`. */
const hc = /** @type {Harness} */ ({ calls: [], auto: {}, gotos: [], page, ws });
/** @type {Window & { __hc037?: Harness }} */ (window).__hc037 = hc;
window.fetch = (url, init = {}) => {
  const method = init.method ?? 'GET';
  const key = `${method} ${String(url)}`;
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  return new Promise((resolve, reject) => {
    /** @type {ScriptedCall} */
    const call = {
      key,
      body,
      settled: null,
      ok(payload) {
        call.settled = 'ok';
        resolve(new Response(JSON.stringify(payload ?? { ok: true }), { status: 200 }));
      },
      fail(status = 500) {
        call.settled = `fail:${status}`;
        resolve(new Response('{}', { status }));
      },
      lose() {
        call.settled = 'lost';
        reject(new TypeError('Failed to fetch'));
      },
    };
    hc.calls.push(call);
    const auto = hc.auto[key];
    if (auto) auto(call);
  });
};

mount(Fixture, { target: /** @type {HTMLElement} */ (document.getElementById('app')) });
