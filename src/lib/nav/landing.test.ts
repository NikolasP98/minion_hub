import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CHAT_PATH, LEGACY_HOME_PATH, SAFE_PATH, effectiveLandingPage } from './landing';

const ORG = ['/chat', '/overview', '/team'];
const MODULES = ['/pos/sell', '/pos/appointments', '/crm', '/stock/items'];

function land(over: Partial<Parameters<typeof effectiveLandingPage>[0]> = {}) {
  return effectiveLandingPage({
    userChoice: undefined,
    orgChoice: undefined,
    canView: () => true,
    mode: 'full',
    orgItems: ORG,
    moduleHrefs: MODULES,
    ...over,
  });
}

describe('effectiveLandingPage', () => {
  it('honours a viewable user choice first', () => {
    expect(land({ userChoice: '/stock/items', orgChoice: '/overview' })).toBe('/stock/items');
  });

  it('skips a user choice the member can no longer view (module off, page denied)', () => {
    const canView = (p: string) => !p.startsWith('/stock');
    expect(land({ userChoice: '/stock/items', orgChoice: '/overview', canView })).toBe('/overview');
  });

  it('uses the org choice when the member has none', () => {
    expect(land({ orgChoice: '/team' })).toBe('/team');
  });

  it('full mode falls to the first viewable organization item', () => {
    expect(land({ canView: (p) => p !== '/chat' })).toBe('/overview');
  });

  it('module mode falls to the first viewable module page', () => {
    const canView = (p: string) => !p.startsWith('/pos');
    expect(land({ mode: 'module', canView })).toBe('/crm');
  });

  it('a personal org with no organization items and nothing viewable lands on chat', () => {
    expect(land({ orgItems: [], moduleHrefs: [], mode: 'module' })).toBe(CHAT_PATH);
    expect(land({ canView: () => false })).toBe(CHAT_PATH);
  });

  it('ignores unsafe or non-string choices', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'overview', 42, null]) {
      expect(land({ userChoice: bad, orgChoice: bad, orgItems: ['/overview'] })).toBe('/overview');
    }
  });

  it('accepts query strings and custom-section instance paths', () => {
    expect(SAFE_PATH.test('/agents?archetype=copilot')).toBe(true);
    expect(SAFE_PATH.test('/staff/sell~k3x9q2')).toBe(true);
  });

  it('returns a stale /home preference as is — the route answers 308 to /chat', () => {
    expect(land({ userChoice: LEGACY_HOME_PATH })).toBe(LEGACY_HOME_PATH);
  });
});

describe('landing literals (FR-011)', () => {
  it("'/home' and '/chat' literals live only in landing.ts, the redirect pages and tests", () => {
    const root = join(process.cwd(), 'src');
    const literal = /['"`]\/(home|chat)['"`]/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'paraglide') walk(full);
          continue;
        }
        if (!/\.(ts|js|svelte)$/.test(entry.name)) continue;
        const rel = relative(root, full).split(sep).join('/');
        if (rel.endsWith('.test.ts') || rel === 'lib/nav/landing.ts') continue;
        if (rel.startsWith('routes/(app)/home/')) continue;
        if (literal.test(readFileSync(full, 'utf8'))) hits.push(rel);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
