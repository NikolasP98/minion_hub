import { describe, expect, it } from 'vitest';
import { sectionAccessWriteSchema } from './section-access';
const revision = 'a'.repeat(64);
const caps = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: false,
  manage: false,
};
describe('contextual access wire admission', () => {
  it('accepts stable module, section, alias and native targets', () => {
    for (const target of [
      'crm',
      'crm.insights',
      'section:abc123',
      'page:abc123',
      'page:/crm/customers',
    ])
      expect(
        sectionAccessWriteSchema.safeParse({
          target,
          roleKey: 'viewer',
          revision,
          mode: 'override',
          caps,
        }).success,
      ).toBe(true);
  });
  it('rejects actor/org injection, incomplete actions, invalid mode combinations and unbounded values', () => {
    const base = { target: 'crm', roleKey: 'viewer', revision, mode: 'override', caps };
    for (const value of [
      { ...base, orgId: 'foreign' },
      { ...base, profileId: 'foreign' },
      { ...base, caps: { view: true } },
      { ...base, fieldLevel: 10 },
      { ...base, mode: 'inherit' },
      { ...base, revision: 'old' },
      { ...base, target: 'page:https://other.example' },
      { ...base, target: 'section:FOREIGN' },
    ])
      expect(sectionAccessWriteSchema.safeParse(value).success).toBe(false);
  });
});
