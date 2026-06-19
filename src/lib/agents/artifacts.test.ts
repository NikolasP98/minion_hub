import { describe, it, expect } from 'vitest';
import {
  overviewDescriptorFor,
  agentVmToArtifactContext,
  artifactSrc,
  triageDescriptorFor,
  triageStatusDetail,
  mapRecentRows,
  type ArtifactDescriptor,
} from './artifacts';
import type { AutonomousAgentVM } from './autonomous';

describe('overviewDescriptorFor', () => {
  it('builds the overview descriptor with icon + description', () => {
    expect(overviewDescriptorFor('scheduling.reminders', 'Overview', 'Live status & activity.')).toEqual({
      id: 'overview',
      agentId: 'scheduling.reminders',
      slot: 'detail',
      title: 'Overview',
      description: 'Live status & activity.',
      icon: 'LayoutDashboard',
      kind: 'static',
      entrypoint: 'index.html',
    });
  });
});

describe('agentVmToArtifactContext', () => {
  it('maps a VM into artifact context', () => {
    const vm: AutonomousAgentVM = {
      id: 'scheduling.reminders',
      source: 'system',
      name: 'Reminders',
      role: 'Appointment Reminders',
      description: 'Sends reminders.',
      avatarUrl: 'https://x/y',
      trigger: 'On booking',
      managePath: '/scheduling/reminders',
      status: { enabled: true, state: 'active', stats: { sent: 5, failed: 0, skipped: 1 } },
    };
    expect(agentVmToArtifactContext(vm)).toEqual({
      agentId: 'scheduling.reminders',
      agentName: 'Reminders',
      agentRole: 'Appointment Reminders',
      agentDescription: 'Sends reminders.',
      status: vm.status,
      trigger: 'On booking',
    });
  });
});

describe('artifactSrc', () => {
  it('builds a same-origin /artifacts URL with the hostOrigin hash', () => {
    const d: ArtifactDescriptor = { id: 'overview', agentId: 'a', slot: 'detail', title: 'Overview', description: 'Overview', icon: 'LayoutDashboard', kind: 'static', entrypoint: 'index.html' };
    expect(artifactSrc(d, 'https://hub.example.com')).toBe(
      'https://hub.example.com/artifacts/overview/ui/index.html#hostOrigin=https%3A%2F%2Fhub.example.com',
    );
  });
});

describe('triageDescriptorFor', () => {
  it('builds the triage descriptor with Megaphone icon', () => {
    expect(triageDescriptorFor('alert-watcher', 'Triage', 'desc')).toEqual({
      id: 'triage', agentId: 'alert-watcher', slot: 'detail', title: 'Triage',
      description: 'desc', icon: 'Megaphone', kind: 'static', entrypoint: 'index.html',
    });
  });
});

describe('triageStatusDetail', () => {
  const L = { unavailable: 'U', none: 'N', count: (t: number, h: number) => `${t}a/${h}h` };
  it('selects the localized label by count state', () => {
    expect(triageStatusDetail({ total: 12, high: 3, med: 0, low: 0, notified: 0, responded: 0 }, L)).toBe('12a/3h');
    expect(triageStatusDetail({ total: 0, high: 0, med: 0, low: 0, notified: 0, responded: 0 }, L)).toBe('N');
    expect(triageStatusDetail(null, L)).toBe('U');
  });
});

describe('mapRecentRows', () => {
  it('maps ComplaintRow shape to recent[]', () => {
    const out = mapRecentRows([{ severity: 'high', category: 'billing', summary: 's', created_at: 123 }]);
    expect(out).toEqual([{ severity: 'high', category: 'billing', summary: 's', createdAt: 123 }]);
  });
  it('ignores malformed rows', () => {
    expect(mapRecentRows([{}, { severity: 'low', category: 'x', summary: 'y', created_at: 1 }])).toHaveLength(1);
  });
});
