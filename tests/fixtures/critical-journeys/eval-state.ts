import type { SandboxElementRecord } from '$lib/sandbox/host.svelte';
/** Fixed transport fixtures; never populated from executable protocol input. */
export function initialSandboxElements(id: 'empty' | 'one-element'): SandboxElementRecord[] {
  return id === 'one-element'
    ? [
        {
          id: 'fixture-element',
          title: 'Fixture visual',
          page: 'sandbox',
          position: 0,
          w: 1,
          h: 1,
          html: '<p>Fixture</p>',
          css: '',
          js: '',
          published: false,
          mine: true,
          createdBy: 'fixture-user',
          updatedAt: '2026-10-23T00:00:00.000Z',
        },
      ]
    : [];
}
