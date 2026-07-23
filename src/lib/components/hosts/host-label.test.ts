import { describe, it, expect } from 'vitest';
import { hostLabel, type LabelHost } from './host-label';

const ORGS = new Map([
  ['org-mini', 'MINION'],
  ['org-pino', 'PINONITE'],
]);

const FLEET: LabelHost[] = [
  { id: 'aaaaaaaa-1', name: 'netcup-prd', url: 'wss://netcup', orgId: 'org-mini' },
  { id: 'bbbbbbbb-2', name: 'netcup-faces-prd', url: 'wss://netcup:10000', orgId: 'org-faces' },
  { id: 'cccccccc-3', name: 'netcup-prd', url: 'wss://netcup', orgId: 'org-pino' },
  { id: 'dddddddd-4', name: 'protopi-dev', url: 'wss://protopi:8443', orgId: 'org-mini' },
  { id: 'eeeeeeee-5', name: 'protopi-dev', url: 'wss://protopi:8443', orgId: 'org-pino' },
];

describe('hostLabel', () => {
  it('leaves a unique name alone', () => {
    expect(hostLabel(FLEET[1], FLEET, ORGS)).toBe('netcup-faces-prd');
  });

  it('qualifies colliding names with the org', () => {
    expect(hostLabel(FLEET[3], FLEET, ORGS)).toBe('protopi-dev · MINION');
    expect(hostLabel(FLEET[4], FLEET, ORGS)).toBe('protopi-dev · PINONITE');
  });

  it('NEVER renders two identical labels, even with no org names', () => {
    const labels = FLEET.map((h) => hostLabel(h, FLEET, new Map()));
    expect(new Set(labels).size).toBe(FLEET.length);
  });

  it('falls back to the id when name AND url both collide and org is unknown', () => {
    expect(hostLabel(FLEET[4], FLEET, new Map())).toBe('protopi-dev · eeeeeeee');
  });

  it('falls back to the url when only the name collides', () => {
    const fleet: LabelHost[] = [
      { id: 'a1', name: 'gw', url: 'wss://one' },
      { id: 'b2', name: 'gw', url: 'wss://two' },
    ];
    expect(hostLabel(fleet[0], fleet, new Map())).toBe('gw · one');
  });
});
