import { describe, it, expect } from 'vitest';
import {
  remindersStatus,
  systemMetaToVM,
  buildSystemAgentVMs,
  gatewayAgentToVM,
  type SystemAgentMeta,
  type SystemAgentStatus,
} from './autonomous';

const meta: SystemAgentMeta = {
  id: 'scheduling.reminders',
  moduleId: 'scheduling',
  name: 'Reminders',
  role: 'Appointment Reminders',
  description: 'Sends WhatsApp reminders automatically.',
  avatarSeed: 'minion-reminders-agent',
  trigger: 'On booking · 24h before · 2h before',
  managePath: '/scheduling/reminders',
};

describe('remindersStatus', () => {
  it('disabled when not enabled', () => {
    expect(remindersStatus({ enabled: false, hasAccount: false })).toMatchObject({
      enabled: false,
      state: 'disabled',
    });
  });
  it('attention when enabled but no account', () => {
    const s = remindersStatus({ enabled: true, hasAccount: false });
    expect(s.state).toBe('attention');
    expect(s.detail).toBeTruthy();
  });
  it('active when enabled with account, carries stats', () => {
    const s = remindersStatus({ enabled: true, hasAccount: true, stats: { sent: 5, failed: 1, skipped: 0 } });
    expect(s.state).toBe('active');
    expect(s.stats?.sent).toBe(5);
  });
});

describe('systemMetaToVM', () => {
  it('maps meta + status into a system VM with a dicebear avatar', () => {
    const status: SystemAgentStatus = { enabled: true, state: 'active' };
    const vm = systemMetaToVM(meta, status);
    expect(vm).toMatchObject({
      id: 'scheduling.reminders',
      source: 'system',
      name: 'Reminders',
      role: 'Appointment Reminders',
      managePath: '/scheduling/reminders',
      trigger: 'On booking · 24h before · 2h before',
    });
    expect(vm.avatarUrl).toContain('api.dicebear.com');
    expect(vm.avatarUrl).toContain('minion-reminders-agent');
    expect(vm.status).toBe(status);
  });
});

describe('buildSystemAgentVMs', () => {
  it('includes agents whose module is enabled', () => {
    const vms = buildSystemAgentVMs([meta], () => true, {
      'scheduling.reminders': { enabled: true, state: 'active' },
    });
    expect(vms).toHaveLength(1);
    expect(vms[0].id).toBe('scheduling.reminders');
  });
  it('hides agents whose module is disabled', () => {
    const vms = buildSystemAgentVMs([meta], (mid) => mid !== 'scheduling', {});
    expect(vms).toHaveLength(0);
  });
  it('defaults to a disabled status when none resolved', () => {
    const vms = buildSystemAgentVMs([meta], () => true, {});
    expect(vms[0].status).toMatchObject({ enabled: false, state: 'disabled' });
  });
});

describe('gatewayAgentToVM', () => {
  it('returns null for non-autonomous archetypes', () => {
    expect(gatewayAgentToVM({ id: 'a1', name: 'Helper' }, 'copilot')).toBeNull();
    expect(gatewayAgentToVM({ id: 'a1', name: 'Helper' }, undefined)).toBeNull();
  });
  it('maps an autonomous gateway agent into a VM with no manage target', () => {
    const vm = gatewayAgentToVM({ id: 'a1', name: 'Nightly Job', status: 'idle' }, 'autonomous');
    expect(vm).toMatchObject({ id: 'a1', source: 'gateway', name: 'Nightly Job', managePath: null });
    expect(vm?.avatarUrl).toContain('api.dicebear.com');
    expect(vm?.status.state).toBe('active');
  });
});
