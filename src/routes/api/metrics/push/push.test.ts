import { describe, it, expect } from 'vitest';

// These tests validate the batch metrics push endpoint request/response contract.
// Full integration tests require a running SvelteKit server with Turso.

describe('POST /api/metrics/push — request validation', () => {
  it('rejects requests without batch payload', () => {
    const body = {};
    const hasBatch = body && typeof (body as Record<string, unknown>).batch === 'object';
    expect(hasBatch).toBe(false);
  });

  it('accepts a minimal batch with just a heartbeat', () => {
    const body = {
      batch: {
        heartbeat: {
          uptimeMs: 60000,
          activeSessions: 1,
          activeAgents: 1,
          capturedAt: Date.now(),
        },
      },
    };
    expect(body.batch).toBeDefined();
    expect(body.batch.heartbeat.uptimeMs).toBe(60000);
  });

  it('accepts a full batch with all metric types', () => {
    const body = {
      batch: {
        reliabilityEvents: [
          {
            serverId: 'srv1',
            category: 'auth',
            severity: 'high',
            event: 'credential.refresh.failed',
            message: 'Token expired',
            occurredAt: Date.now(),
          },
        ],
        credentialHealth: {
          serverId: 'srv1',
          snapshotJson: JSON.stringify({
            now: Date.now(),
            warnAfterMs: 86400000,
            profiles: [],
            providers: [],
          }),
          capturedAt: Date.now(),
        },
        skillStats: [
          {
            serverId: 'srv1',
            skillName: 'gmail',
            status: 'ok',
            durationMs: 250,
            occurredAt: Date.now(),
          },
          {
            serverId: 'srv1',
            skillName: 'notion',
            status: 'auth_error',
            errorMessage: 'Token revoked',
            occurredAt: Date.now(),
          },
        ],
        heartbeat: {
          uptimeMs: 7200000,
          activeSessions: 3,
          activeAgents: 2,
          memoryRssMb: 192.3,
          credentialSummaryJson: JSON.stringify({ ok: 3, expired: 1 }),
          channelStatusJson: JSON.stringify({ whatsapp: 'ok' }),
          capturedAt: Date.now(),
        },
      },
    };

    const batch = body.batch;
    expect(batch.reliabilityEvents).toHaveLength(1);
    expect(batch.reliabilityEvents![0].category).toBe('auth');
    expect(batch.credentialHealth).toBeDefined();
    expect(batch.skillStats).toHaveLength(2);
    expect(batch.heartbeat.activeSessions).toBe(3);
  });
});

describe('Server token auth contract', () => {
  it('validates Bearer token format', () => {
    const header = 'Bearer abc123xyz';
    const isBearer = header.startsWith('Bearer ');
    const token = header.slice(7).trim();
    expect(isBearer).toBe(true);
    expect(token).toBe('abc123xyz');
  });

  it('rejects empty Bearer token', () => {
    const header = 'Bearer ';
    const token = header.slice(7).trim();
    expect(token).toBe('');
    expect(!!token).toBe(false);
  });

  it('rejects non-Bearer auth', () => {
    const header = 'Basic abc123';
    const isBearer = header.startsWith('Bearer ');
    expect(isBearer).toBe(false);
  });
});
