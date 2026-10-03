import { mount } from 'svelte';
import '../../../src/app.css';
import Fixture from './Fixture.svelte';
import { ACTOR, PERSON, ORG_A, page } from './page.svelte';
import { applyTheme } from '$lib/themes/runtime';
import { PRESETS, ACCENT_OPTIONS } from '$lib/themes/presets';

function setTheme(id: string) {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  const accent = ACCENT_OPTIONS.find((candidate) => candidate.id === 'blue');
  if (!preset || !accent) throw new Error('Unknown synthetic theme');
  applyTheme(preset, accent.value);
}
Object.assign(window, { mentionTheme: setTheme });
setTheme('new-york');

const transport = {
  calls: [] as Array<{ organizationId: string; signal: AbortSignal | undefined }>,
  pending: [] as Array<() => void>,
  automatic: true,
  failNext: false,
};
Object.assign(window, { mentionTransport: transport });
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input) !== '/api/users/aliases') throw new Error('Fixture refuses unrelated requests');
  const org = page.data.activeOrgId;
  transport.calls.push({ organizationId: org, signal: init?.signal ?? undefined });
  if (transport.failNext) {
    transport.failNext = false;
    throw new Error('Synthetic directory unavailable');
  }
  const payload = {
    actorId: ACTOR,
    organizationId: org,
    aliases: { [PERSON]: org === ORG_A ? 'colleague' : 'current_person' },
  };
  // Deliberately non-cooperative transport makes stale-reply fencing observable.
  return await new Promise<Response>((resolve) => {
    const settle = () => resolve(Response.json(payload));
    transport.pending.push(settle);
    if (transport.automatic) setTimeout(settle, 30);
  });
};
mount(Fixture, { target: document.getElementById('app')! });
