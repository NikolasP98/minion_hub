import { defineModuleFacts } from '../sdk';

/** Stock availability facts — label-free so `MODULE_MANIFEST` can import them (see `ModuleFacts`). */
export const stockFacts = defineModuleFacts({
  id: 'stock',
  appPrefixes: ['/stock'],
  toggleId: 'stock',
  kinds: ['business'],
});
