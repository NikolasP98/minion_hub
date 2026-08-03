import { describe, it, expect } from 'vitest';
import { getSections, getDynamicPluginsSections, getNavSections } from './sections';
import type { PluginUiManifestOccupant } from '$lib/plugins/plugin-types';

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

describe('personal-org nav gating', () => {
  it('hides pos/stock/workforce for personal orgs, adds /pulse', () => {
    const secs = getDynamicPluginsSections([], {}, 'personal');
    const hrefs = secs.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain('/pos');
    expect(hrefs).not.toContain('/stock');
    expect(hrefs).not.toContain('/workforce');
    expect(hrefs).toContain('/pulse');
  });

  it('keeps them for business orgs', () => {
    const secs = getDynamicPluginsSections([], {}, 'business');
    const hrefs = secs.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain('/pos');
    expect(hrefs).toContain('/stock');
    expect(hrefs).toContain('/workforce');
  });

  it('keeps them when orgKind is omitted (safe default)', () => {
    const secs = getDynamicPluginsSections([]);
    const hrefs = secs.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain('/pos');
  });

  // S3/WP1: deliberate expansion — support/memberships/sales/ads/team also
  // drop for personal orgs (org-kind.ts ORG_KIND_POLICY).
  it('hides support/memberships/sales/ads/team for personal orgs', () => {
    const secs = getDynamicPluginsSections([], {}, 'personal');
    const hrefs = secs.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain('/support');
    expect(hrefs).not.toContain('/memberships');
    expect(hrefs).not.toContain('/sales');
    expect(hrefs).not.toContain('/socials');
    const orgHrefs = getSections('personal').find((s) => s.id === 'organization')?.items.map((i) => i.href);
    expect(orgHrefs).not.toContain('/team');
  });
});

describe('getSections — personal org (R2)', () => {
  it('drops /team but keeps Home/Overview, relabels the group "My Space"', () => {
    const org = getSections('personal').find((s) => s.id === 'organization');
    expect(org?.items.map((i) => i.href)).toEqual(['/home', '/overview']);
    expect(org?.label).toBe('My Space');
  });

  it('business orgs are unaffected (Home/Overview/Team, "Organization" label)', () => {
    const org = getSections('business').find((s) => s.id === 'organization');
    expect(org?.items.map((i) => i.href)).toEqual(['/home', '/overview', '/team']);
    expect(org?.label).toBe('Organization');
  });
});

describe('getNavSections — personal org regrouping (R2)', () => {
  const voiceCallPlugin: PluginUiManifestOccupant = {
    pluginId: 'voice-call',
    slot: 'plugins.controlCenter' as const,
    title: 'Voice Calls',
    description: '',
    entrypoint: 'c.html',
    category: 'tool' as const,
  };
  const whatsapp: PluginUiManifestOccupant = {
    pluginId: 'whatsapp',
    slot: 'plugins.controlCenter' as const,
    title: 'WhatsApp',
    description: '',
    entrypoint: 'c.html',
    category: 'channel' as const,
  };
  const studio: PluginUiManifestOccupant = {
    pluginId: 'studio',
    slot: 'plugins.controlCenter' as const,
    title: 'Studio',
    description: '',
    entrypoint: 'c.html',
    category: 'creative' as const,
  };

  it('merges Pulse + My Work into a single "My Space" group with Home/Overview', () => {
    const secs = getNavSections('personal', [], {});
    const mySpace = secs.find((s) => s.id === 'organization');
    expect(mySpace?.label).toBe('My Space');
    expect(mySpace?.items.map((i) => i.href)).toEqual(
      expect.arrayContaining(['/home', '/overview', '/pulse', '/work']),
    );
    expect(mySpace?.items).toHaveLength(4);
    // no separate "plugins:my-space" section leaks through
    expect(secs.find((s) => s.id === 'plugins:my-space')).toBeUndefined();
  });

  it('groups People (relabeled CRM), Scheduling, Channels, Voice Calls under "Relationships"', () => {
    const secs = getNavSections('personal', [voiceCallPlugin, whatsapp], {});
    const relationships = secs.find((s) => s.id === 'plugins:relationships');
    const hrefs = relationships?.items.map((i) => i.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/crm', '/scheduling', '/channels', '/plugins/voice-call']));
    const crmItem = relationships?.items.find((i) => i.href === '/crm');
    expect(crmItem?.label).toBe('People');
  });

  it('Finances lands in a "Money"-labeled group (no Sales/Memberships alongside it)', () => {
    const secs = getNavSections('personal', [], {});
    const money = secs.find((s) => s.id === 'plugins:finance');
    expect(money?.label).toBe('Money');
    expect(money?.items.map((i) => i.href)).toEqual(['/finances']);
  });

  it('remaining permitted plugins fall into "Tools"', () => {
    const secs = getNavSections('personal', [studio], {});
    const tools = secs.find((s) => s.id === 'plugins:tool');
    expect(tools?.items.map((i) => i.href)).toContain('/plugins/studio');
  });

  it('business orgs: unchanged concat, no My Space/Relationships/Money groups', () => {
    const secs = getNavSections('business', [voiceCallPlugin], {});
    expect(secs.find((s) => s.id === 'plugins:relationships')).toBeUndefined();
    expect(secs.find((s) => s.id === 'plugins:my-space')).toBeUndefined();
    const org = secs.find((s) => s.id === 'organization');
    expect(org?.label).toBe('Organization');
    expect(org?.items.map((i) => i.href)).toEqual(['/home', '/overview', '/team']);
  });
});
