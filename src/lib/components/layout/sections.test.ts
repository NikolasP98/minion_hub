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

  it('keeps Copilots/AI Brains as ?archetype= filters and routes Autonomous to its own page', () => {
    const agents = getSections().find((s) => s.id === 'agents');
    const archetypeHrefs = agents?.items
      .map((i) => i.href)
      .filter((h) => h.startsWith('/agents?archetype='));
    expect(archetypeHrefs).toEqual([
      '/agents?archetype=copilot',
      '/agents?archetype=brain',
    ]);
    const autonomous = agents?.items.find((i) => i.href === '/agents/autonomous');
    expect(autonomous).toBeTruthy();
    expect(autonomous?.matcher('/agents/autonomous')).toBe(true);
    expect(autonomous?.matcher('/agents')).toBe(false);
  });
});
