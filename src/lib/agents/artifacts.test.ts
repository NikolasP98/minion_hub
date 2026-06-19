import { describe, it, expect } from 'vitest';
import {
  overviewDescriptorFor,
  agentVmToArtifactContext,
  artifactSrc,
  type ArtifactDescriptor,
} from './artifacts';
import type { AutonomousAgentVM } from './autonomous';

describe('overviewDescriptorFor', () => {
  it('builds the overview descriptor for an agent', () => {
    expect(overviewDescriptorFor('scheduling.reminders', 'Overview')).toEqual({
      id: 'overview',
      agentId: 'scheduling.reminders',
      slot: 'detail',
      title: 'Overview',
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
    const d: ArtifactDescriptor = { id: 'overview', agentId: 'a', slot: 'detail', title: 'Overview', kind: 'static', entrypoint: 'index.html' };
    expect(artifactSrc(d, 'https://hub.example.com')).toBe(
      'https://hub.example.com/artifacts/overview/ui/index.html#hostOrigin=https%3A%2F%2Fhub.example.com',
    );
  });
});
