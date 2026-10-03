import { writable } from 'svelte/store';
export const page = writable({
  url: new URL(
    typeof location === 'undefined'
      ? 'http://fixture.invalid/en/fixture'
      : new URL('/en/fixture', location.origin).href,
  ),
  params: {},
  data: {},
  route: { id: '/fixture' },
});
