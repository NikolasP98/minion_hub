import { describe, it, expect } from 'vitest';
import { checkPluginCompat, compareVersionStrings, type GatewayCapabilities } from './compat';
import { BRIDGE_PROTOCOL_VERSION } from './bridge-protocol';

const caps = (over: Partial<GatewayCapabilities> = {}): GatewayCapabilities => ({
  methods: ['plugins.config.get', 'plugins.config.set', 'plugins.ui.list'],
  version: '2026.6.14',
  bridgeProtocol: BRIDGE_PROTOCOL_VERSION,
  ...over,
});

describe('compareVersionStrings', () => {
  it('orders CalVer segments numerically', () => {
    expect(compareVersionStrings('2026.6.0', '2026.6.14')).toBe(-1);
    expect(compareVersionStrings('2026.6.14', '2026.6.0')).toBe(1);
    expect(compareVersionStrings('2026.6.2', '2026.6.2')).toBe(0);
  });
  it('strips a -suffix before comparing', () => {
    expect(compareVersionStrings('2026.6.14-dev', '2026.6.14')).toBe(0);
    expect(compareVersionStrings('2026.7.0-dev.123', '2026.6.99')).toBe(1);
  });
});

describe('checkPluginCompat', () => {
  it('passes when there is no compat block', () => {
    expect(checkPluginCompat(undefined, caps())).toEqual({ ok: true });
  });

  it('passes when every constraint is satisfied', () => {
    expect(
      checkPluginCompat(
        {
          minGatewayVersion: '2026.6.0',
          requiredRpc: ['plugins.config.get'],
          bridgeProtocol: String(BRIDGE_PROTOCOL_VERSION),
        },
        caps(),
      ),
    ).toEqual({ ok: true });
  });

  it('fails when the gateway is too old', () => {
    const v = checkPluginCompat({ minGatewayVersion: '2027.1.0' }, caps());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons[0]).toMatch(/requires gateway ≥ 2027\.1\.0/);
  });

  it('fails and lists each missing required method', () => {
    const v = checkPluginCompat(
      { requiredRpc: ['plugins.config.get', 'future.alpha', 'future.beta'] },
      caps(),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasons[0]).toMatch(/future\.alpha/);
      expect(v.reasons[0]).toMatch(/future\.beta/);
      expect(v.reasons[0]).not.toMatch(/plugins\.config\.get/);
    }
  });

  it('fails when the plugin needs a newer bridge protocol than the host speaks', () => {
    const v = checkPluginCompat({ bridgeProtocol: '2' }, caps({ bridgeProtocol: 1 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons[0]).toMatch(/bridge protocol 2/);
  });

  it('accumulates multiple failure reasons', () => {
    const v = checkPluginCompat(
      { minGatewayVersion: '2027.1.0', requiredRpc: ['nope.method'] },
      caps(),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons).toHaveLength(2);
  });

  it('denies a constrained unknown gateway version', () => {
    expect(checkPluginCompat({ minGatewayVersion: '2027.1.0' }, caps({ version: null })).ok).toBe(
      false,
    );
  });

  it('denies required RPCs when no methods have been advertised yet', () => {
    expect(checkPluginCompat({ requiredRpc: ['anything'] }, caps({ methods: [] })).ok).toBe(false);
  });
});

describe('strict declared compatibility grammar', () => {
  it.each(['^1', '1junk', '', '0', '-1', '1.0', '99999999999999999999999'])(
    'rejects bridge major %s',
    (bridgeProtocol) => {
      expect(checkPluginCompat({ bridgeProtocol }, caps()).ok).toBe(false);
    },
  );
  it.each(['^2026.1', '2026.x', '2026.1junk', '', '2026..1'])(
    'rejects malformed minimum %s',
    (minGatewayVersion) => {
      expect(checkPluginCompat({ minGatewayVersion }, caps()).ok).toBe(false);
      expect(() => compareVersionStrings(minGatewayVersion, '2026.1')).toThrow();
    },
  );
  it('keeps unconstrained legacy compatible without gateway facts', () => {
    expect(checkPluginCompat(undefined, caps({ methods: [], version: null }))).toEqual({
      ok: true,
    });
  });
  it('rejects missing and invalid capabilities only when constrained', () => {
    expect(checkPluginCompat({ minGatewayVersion: '2026.1' }, caps({ version: 'bad' })).ok).toBe(
      false,
    );
    expect(checkPluginCompat({ bridgeProtocol: '1' }, caps({ bridgeProtocol: NaN })).ok).toBe(
      false,
    );
  });
});
