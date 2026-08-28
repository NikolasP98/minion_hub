import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDashboardLayoutCache,
  loadDashboardLayout,
  primeDashboardLayout,
} from './dashboard-layout-cache';

const layout = { order: ['a'], span: { a: { w: 2, h: 1 } } };

describe('dashboard layout client cache', () => {
  beforeEach(clearDashboardLayoutCache);

  it('coalesces repeat and concurrent reads for one org/dashboard', async () => {
    const fetchLayout = vi.fn(async () => ({ ok: true, json: async () => ({ layout }) }));

    const [first, second] = await Promise.all([
      loadDashboardLayout('org-1', 'crm', fetchLayout),
      loadDashboardLayout('org-1', 'crm', fetchLayout),
    ]);

    expect(first).toEqual(layout);
    expect(second).toEqual(layout);
    expect(fetchLayout).toHaveBeenCalledTimes(1);
  });

  it('never shares a pinned layout across organizations', async () => {
    const fetchLayout = vi.fn(async () => ({ ok: true, json: async () => ({ layout }) }));
    await loadDashboardLayout('org-1', 'crm', fetchLayout);
    await loadDashboardLayout('org-2', 'crm', fetchLayout);
    expect(fetchLayout).toHaveBeenCalledTimes(2);
  });

  it('uses a newly saved default without another request', async () => {
    primeDashboardLayout('org-1', 'crm', layout);
    const fetchLayout = vi.fn();
    await expect(loadDashboardLayout('org-1', 'crm', fetchLayout)).resolves.toEqual(layout);
    expect(fetchLayout).not.toHaveBeenCalled();
  });
});
