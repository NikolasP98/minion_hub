import { describe, expect, it } from 'vitest';
import {
  socialsRouteShell,
  stockRouteShell,
  workforceRouteShell,
  type BusinessRouteShell,
} from './business-route-shells';

function expectRoutes(
  resolve: (pathname: string) => BusinessRouteShell,
  groups: Readonly<Record<BusinessRouteShell['archetype'], readonly string[]>>,
): number {
  let count = 0;
  for (const [archetype, paths] of Object.entries(groups)) {
    for (const path of paths) {
      expect(resolve(path), path).toMatchObject({ archetype });
      count += 1;
    }
  }
  return count;
}

describe('Wave B business route shells', () => {
  it('assigns all six Socials screens to their intended archetypes', () => {
    const count = expectRoutes(socialsRouteShell, {
      dashboard: ['/socials'],
      collection: ['/socials/campaigns', '/socials/posts'],
      'record-detail': ['/socials/campaigns/campaign-1', '/socials/posts/post-1'],
      form: ['/socials/settings'],
      'master-detail': [],
      workspace: [],
      canvas: [],
      terminal: [],
      public: [],
    });
    expect(count).toBe(6);
  });

  it('assigns all ten Stock screens to their intended archetypes', () => {
    const count = expectRoutes(stockRouteShell, {
      dashboard: ['/stock'],
      collection: [
        '/stock/commitments',
        '/stock/consumption',
        '/stock/entries',
        '/stock/items',
        '/stock/warehouses',
      ],
      'record-detail': ['/stock/entries/entry-1', '/stock/items/item-1'],
      form: ['/stock/consume', '/stock/entries/new'],
      'master-detail': [],
      workspace: [],
      canvas: [],
      terminal: [],
      public: [],
    });
    expect(count).toBe(10);
  });

  it('assigns all nineteen Workforce screens to their intended archetypes', () => {
    const count = expectRoutes(workforceRouteShell, {
      dashboard: ['/workforce', '/workforce/costs', '/workforce/reliability'],
      collection: [
        '/workforce/activity',
        '/workforce/approvals',
        '/workforce/goals',
        '/workforce/inbox',
        '/workforce/issues',
        '/workforce/portfolios',
        '/workforce/projects',
      ],
      'record-detail': [
        '/workforce/agents/agent-1',
        '/workforce/issues/issue-1',
        '/workforce/portfolios/portfolio-1',
        '/workforce/projects/project-1',
      ],
      form: ['/workforce/settings', '/workforce/settings/agents'],
      'master-detail': [],
      workspace: ['/workforce/projects/project-1/pipelines'],
      canvas: ['/workforce/org'],
      terminal: [],
      public: ['/workforce/welcome'],
    });
    expect(count).toBe(19);
  });

  it('normalizes trailing slashes and assigns scroll ownership by archetype', () => {
    expect(socialsRouteShell('/socials/')).toEqual({
      archetype: 'dashboard',
      scroll: 'page',
      landmark: true,
    });
    expect(stockRouteShell('/stock/items/')).toEqual({
      archetype: 'collection',
      scroll: 'region',
      landmark: true,
    });
    expect(workforceRouteShell('/workforce/org/')).toEqual({
      archetype: 'canvas',
      scroll: 'none',
      landmark: true,
    });
    expect(workforceRouteShell('/workforce/activity')).toMatchObject({ landmark: false });
    expect(workforceRouteShell('/workforce/inbox')).toMatchObject({ landmark: true });
  });
});
