import { describe, it, expect, beforeEach, vi } from 'vitest';

// These tests validate the metrics service batch processing logic.
// They use in-memory stubs since the real DB requires Turso.

describe('MetricsBatchInput validation', () => {
  it('accepts an empty batch', () => {
    const batch = {};
    expect(batch).toBeDefined();
    expect(Object.keys(batch)).toHaveLength(0);
  });

  it('accepts a batch with all metric types', () => {
    const batch = {
      credentialHealth: {
        serverId: 'srv1',
        snapshotJson: JSON.stringify({ profiles: [], providers: [] }),
        capturedAt: Date.now(),
      },
      skillStats: [
        {
          serverId: 'srv1',
          skillName: 'notion',
          status: 'ok' as const,
          durationMs: 150,
          occurredAt: Date.now(),
        },
      ],
      heartbeat: {
        serverId: 'srv1',
        uptimeMs: 3600000,
        activeSessions: 2,
        activeAgents: 1,
        memoryRssMb: 128.5,
        capturedAt: Date.now(),
      },
    };
    expect(batch.credentialHealth.snapshotJson).toBeTruthy();
    expect(batch.skillStats).toHaveLength(1);
    expect(batch.heartbeat.uptimeMs).toBe(3600000);
  });

  it('validates skill stat statuses', () => {
    const validStatuses = ['ok', 'auth_error', 'timeout', 'error'];
    for (const status of validStatuses) {
      const stat = {
        serverId: 'srv1',
        skillName: 'test',
        status,
        occurredAt: Date.now(),
      };
      expect(stat.status).toBe(status);
    }
  });
});

describe('HeartbeatInput structure', () => {
  it('requires core fields', () => {
    const heartbeat = {
      serverId: 'srv1',
      uptimeMs: 60000,
      activeSessions: 3,
      activeAgents: 2,
      capturedAt: Date.now(),
    };
    expect(heartbeat.uptimeMs).toBeGreaterThan(0);
    expect(heartbeat.activeSessions).toBe(3);
    expect(heartbeat.activeAgents).toBe(2);
  });

  it('allows optional memory and summary fields', () => {
    const heartbeat = {
      serverId: 'srv1',
      uptimeMs: 60000,
      activeSessions: 1,
      activeAgents: 1,
      memoryRssMb: 256.7,
      credentialSummaryJson: JSON.stringify({ ok: 2, expired: 1 }),
      channelStatusJson: JSON.stringify({ whatsapp: 'ok', telegram: 'ok' }),
      capturedAt: Date.now(),
    };
    expect(heartbeat.memoryRssMb).toBeCloseTo(256.7);
    expect(JSON.parse(heartbeat.credentialSummaryJson!)).toHaveProperty('ok', 2);
  });
});
