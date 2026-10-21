import { describe, expect, it } from 'vitest';
import { resumeModuleHref } from './module-navigation';
import { ViewMemory } from './view-memory';
describe('opt-in module navigation', () => {
  it('resumes the module selector while preserving explicit URLs and owner scope', () => {
    const memory = new ViewMemory();
    memory.reconcile('owner');
    memory.write('owner', 'module:crm', '/es/crm/customers?q=ana');
    const from = new URL('https://hub.test/es/pos/sell');
    expect(resumeModuleHref(memory, 'owner', from, '/es/crm')).toBe('/es/crm/customers?q=ana');
    for (const href of [
      '/es/crm?range=all',
      '/es/crm#overview',
      '/es/crm/customer-id',
      'https://other.test/es/crm',
    ])
      expect(resumeModuleHref(memory, 'owner', from, href)).toBe(href);
    expect(resumeModuleHref(memory, 'other', from, '/es/crm')).toBe('/es/crm');
    expect(
      resumeModuleHref(memory, 'owner', new URL('https://hub.test/es/crm/customers'), '/es/crm'),
    ).toBe('/es/crm');
  });
});
