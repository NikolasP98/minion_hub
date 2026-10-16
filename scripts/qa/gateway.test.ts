/**
 * Unit tests for the pure config plumbing of `dev:local --gateway`
 * (meta spec 011-dev-local-gateway-mode, D1-D3).
 *
 * Nothing here starts a container or touches a database: these are the pure
 * functions whose output decides whether a developer secret leaks into the hub
 * and whether the gateway names resolve to loopback.
 */
import { describe, expect, test } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GATEWAY_HTTP_URL,
  GATEWAY_PORT,
  GATEWAY_WS_URL,
  PROVIDER_ENV_KEYS,
  buildGatewayConfig,
  buildGatewayEnvFile,
  buildGatewayEnvVars,
  collectProviderKeys,
  loadOrCreateGatewayToken,
  writeGatewayState,
} from './gateway';
import { agentCreateParams, personalAgentId } from './gateway-bootstrap';
import { buildEnvQa } from './env';
import { OUTBOUND_SERVICE_ENV_KEYS } from './backend';
import { isLoopbackHostname } from './backend';

const STATUS = {
  apiUrl: 'http://127.0.0.1:54421',
  dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
  anonKey: 'anon',
  serviceRoleKey: 'service',
};
const GATEWAY_ENV_KEYS = [
  'MINION_GATEWAY_URL',
  'OPENCLAW_GATEWAY_URL',
  'MINION_GATEWAY_PRIMARY_URL',
  'MINION_GATEWAY_BROADCAST_URL',
  'OPENCLAW_GATEWAY_TOKEN',
] as const;

describe('collectProviderKeys', () => {
  test('keeps only non-empty provider keys', () => {
    expect(
      collectProviderKeys({
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        OPENROUTER_API_KEY: '   ',
        OPENAI_API_KEY: 'sk-openai',
        SUPABASE_DB_URL: 'postgres://nope',
      }),
    ).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-xxx' });
  });

  test('empty env yields no keys (so the warning path is reachable)', () => {
    expect(collectProviderKeys({})).toEqual({});
  });

  test('every provider key it forwards is also blanked in .env.qa — the hub stays keyless', () => {
    for (const key of PROVIDER_ENV_KEYS) {
      expect(OUTBOUND_SERVICE_ENV_KEYS).toContain(key);
    }
  });
});

describe('buildGatewayEnvVars', () => {
  const vars = buildGatewayEnvVars('tok-123');

  test('resolves exactly the five names .env.qa normally blanks', () => {
    expect(Object.keys(vars).sort()).toEqual([...GATEWAY_ENV_KEYS].sort());
  });

  test('every URL it resolves is loopback', () => {
    for (const [key, value] of Object.entries(vars)) {
      if (!key.endsWith('_URL')) continue;
      expect(isLoopbackHostname(new URL(value).hostname)).toBe(true);
    }
  });

  test('the dashboard dials the WS port; the cache broadcaster uses http', () => {
    expect(vars.MINION_GATEWAY_URL).toBe(GATEWAY_WS_URL);
    expect(vars.MINION_GATEWAY_PRIMARY_URL).toBe(GATEWAY_WS_URL);
    expect(vars.MINION_GATEWAY_BROADCAST_URL).toBe(GATEWAY_HTTP_URL);
    expect(GATEWAY_WS_URL).toContain(String(GATEWAY_PORT));
  });

  test('carries the token', () => {
    expect(vars.OPENCLAW_GATEWAY_TOKEN).toBe('tok-123');
  });
});

describe('buildEnvQa gateway mode', () => {
  test('default output blanks every gateway name (US2 — default mode stays sealed)', () => {
    const body = buildEnvQa(STATUS, 'enc-key');
    for (const key of GATEWAY_ENV_KEYS) {
      expect(body).toContain(`${key}=\n`);
    }
    expect(body).not.toContain('Local gateway');
  });

  test('gateway mode resolves the five names and leaves the rest blank', () => {
    const body = buildEnvQa(STATUS, 'enc-key', {}, buildGatewayEnvVars('tok-123'));
    expect(body).toContain(`MINION_GATEWAY_URL=${GATEWAY_WS_URL}`);
    expect(body).toContain('OPENCLAW_GATEWAY_TOKEN=tok-123');
    // No name appears twice — a blank line would otherwise win or lose by order.
    for (const key of GATEWAY_ENV_KEYS) {
      expect(body.split('\n').filter((l) => l.startsWith(`${key}=`))).toHaveLength(1);
    }
    // The provider keys are still empty: they go to the container, not the hub.
    for (const key of PROVIDER_ENV_KEYS) {
      expect(body).toContain(`${key}=\n`);
    }
  });
});

describe('buildGatewayEnvFile', () => {
  test('carries the token and every provider key slot', () => {
    const body = buildGatewayEnvFile('tok-123', { ANTHROPIC_API_KEY: 'sk-ant' });
    expect(body).toContain('MINION_GATEWAY_TOKEN=tok-123');
    expect(body).toContain('ANTHROPIC_API_KEY=sk-ant');
    // Declared-but-absent, so the container sees "" rather than inheriting.
    expect(body).toContain('OPENROUTER_API_KEY=\n');
  });
});

describe('buildGatewayConfig', () => {
  test('adds hubMetrics without discarding the image defaults', () => {
    const base = {
      gateway: { mode: 'local', auth: { mode: 'token', allowTailscale: true } },
      logging: { level: 'info' },
    };
    const out = buildGatewayConfig(base, {
      hubUrl: 'http://127.0.0.1:5199',
      token: 'tok-123',
      serverId: 'qa-local-gateway',
    });
    const gateway = out.gateway as Record<string, unknown>;
    expect(gateway.hubMetrics).toEqual({
      hubUrl: 'http://127.0.0.1:5199',
      apiKey: 'tok-123',
      serverId: 'qa-local-gateway',
    });
    // The auth mode is what makes MINION_GATEWAY_TOKEN be enforced at all.
    expect(gateway.auth).toEqual({ mode: 'token', allowTailscale: true });
    expect(out.logging).toEqual({ level: 'info' });
  });

  test('tolerates an empty base (the image could not be read)', () => {
    const out = buildGatewayConfig(
      {},
      { hubUrl: 'http://127.0.0.1:5199', token: 't', serverId: 's' },
    );
    expect((out.gateway as Record<string, unknown>).hubMetrics).toBeTruthy();
  });
});

describe('loadOrCreateGatewayToken', () => {
  test('is stable across calls and owner-only on disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-gateway-token-'));
    const first = loadOrCreateGatewayToken(root);
    const second = loadOrCreateGatewayToken(root);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    // 600: the sealed copy in the `gateway` row is only as private as this file.
    expect(statSync(join(root, '.qa', 'gateway-token')).mode & 0o777).toBe(0o600);
  });
});

describe('gateway-bootstrap pure helpers', () => {
  test('personalAgentId prefixes a seeded id and is idempotent', () => {
    expect(personalAgentId('qa_abc123')).toBe('personal-abc123');
    expect(personalAgentId('personal-abc123')).toBe('personal-abc123');
    // The prefix is load-bearing: the gateway gates its hub-module tools on it.
    expect(personalAgentId('qa_abc123').startsWith('personal-')).toBe(true);
  });

  test('agentCreateParams matches the hub provisioner payload shape', () => {
    expect(agentCreateParams('personal-abc')).toEqual({
      name: 'personal-abc',
      workspace: '~/.minion/agents/personal-abc/workspace',
    });
  });
});

describe('writeGatewayState permissions', () => {
  const config = () =>
    buildGatewayConfig(
      { gateway: { auth: { mode: 'token' } } },
      { hubUrl: 'http://127.0.0.1:5199', token: 'tok-secret', serverId: 'qa-local-gateway' },
    );

  test('the state dir is 0700 and minion.json is 0600', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-gateway-state-'));
    const stateDir = join(root, 'gateway');
    const path = writeGatewayState(stateDir, config);
    // minion.json carries the gateway token (hubMetrics.apiKey is config-only;
    // the gateway has no env fallback for it), so it must be no more readable
    // than .qa/gateway-token. An explicit chmod, not the process umask.
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(stateDir, 'workspace')).mode & 0o777).toBe(0o700);
  });

  test('tightens a config an earlier run left world-readable', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-gateway-state-'));
    const stateDir = join(root, 'gateway');
    mkdirSync(stateDir, { recursive: true });
    const path = join(stateDir, 'minion.json');
    writeFileSync(path, JSON.stringify(config()));
    chmodSync(path, 0o644);
    chmodSync(stateDir, 0o755);
    writeGatewayState(stateDir, config);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
  });

  test('does not overwrite an existing config', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-gateway-state-'));
    const stateDir = join(root, 'gateway');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'minion.json'), '{"mine":true}');
    writeGatewayState(stateDir, config);
    expect(JSON.parse(readFileSync(join(stateDir, 'minion.json'), 'utf8'))).toEqual({ mine: true });
  });

  test('the token is nowhere outside 0600 files', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-gateway-state-'));
    const stateDir = join(root, 'gateway');
    const path = writeGatewayState(stateDir, config);
    // It IS in minion.json — hubMetrics.apiKey has no env alternative — so the
    // guarantee this asserts is the mode, not the absence.
    expect(readFileSync(path, 'utf8')).toContain('tok-secret');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
