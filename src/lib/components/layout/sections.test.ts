import { describe, it, expect } from 'vitest';
import { getSections } from './sections';

describe('getSections — core nav taxonomy', () => {
  it('exposes Organization (Home/Overview/Team) and Agents groups', () => {
    const ids = getSections().map((s) => s.id);
    expect(ids).toEqual(['organization', 'agents']);
    const org = getSections().find((s) => s.id === 'organization');
    expect(org?.items.map((i) => i.href)).toEqual(['/home', '/overview', '/team']);
  });

  it('includes Agent Builder (/flow-editor) in the Agents section', () => {
    const agents = getSections().find((s) => s.id === 'agents');
    const item = agents?.items.find((i) => i.href === '/flow-editor');
    expect(item).toBeTruthy();
    expect(item?.label).toBeTruthy();
  });

  it('keeps Copilots as an ?archetype= filter and routes Autonomous to its own page', () => {
    const agents = getSections().find((s) => s.id === 'agents');
    const archetypeHrefs = agents?.items
      .map((i) => i.href)
      .filter((h) => h.startsWith('/agents?archetype='));
    expect(archetypeHrefs).toEqual(['/agents?archetype=copilot']);
    const autonomous = agents?.items.find((i) => i.href === '/agents/autonomous');
    expect(autonomous).toBeTruthy();
    expect(autonomous?.matcher('/agents/autonomous')).toBe(true);
    expect(autonomous?.matcher('/agents')).toBe(false);
  });

  // P4.1 W1: AI Brains consolidated into the /brains module nav (SideNav
  // subtabs) — the ?archetype=brain roster filter no longer has its own
  // sidebar entry (the URL still works, just isn't a nav link anymore).
  it('no longer has a standalone AI Brains archetype filter in the sidebar', () => {
    const agents = getSections().find((s) => s.id === 'agents');
    const brainItem = agents?.items.find((i) => i.href === '/agents?archetype=brain');
    expect(brainItem).toBeUndefined();
  });
});
