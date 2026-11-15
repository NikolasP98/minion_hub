import { describe, expect, it } from 'vitest';
import { _legacyFilterRedirect } from './+page.server';

const at = (search: string) => new URL(`http://h/es/crm/customers${search}`);

describe('_legacyFilterRedirect', () => {
  it('leaves current URLs alone', () => {
    expect(_legacyFilterRedirect(at('?f.awaiting=1&q=ana'))).toBeNull();
  });

  it('rewrites the old toolbar params to column filters, keeping the rest', () => {
    expect(_legacyFilterRedirect(at('?tag=t1&reserved=1&awaiting=1&temp=hot'))).toBe(
      '/es/crm/customers?temp=hot&f.tags=t1&f.reserved=1&f.awaiting=1',
    );
  });

  it('drops off-values and never overrides an explicit column filter', () => {
    expect(_legacyFilterRedirect(at('?reserved=0&tag=old&f.tags=new'))).toBe(
      '/es/crm/customers?f.tags=new',
    );
  });
});
