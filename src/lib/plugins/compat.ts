import { BRIDGE_PROTOCOL_VERSION } from './bridge-protocol';
import type { PluginCompat } from './plugin-types';

/**
 * Host-side plugin compatibility gating.
 *
 * The gateway advertises its capabilities in the connect handshake
 * (`hello-ok.features.methods` + `server.version`); the host knows its own
 * bridge protocol version (BRIDGE_PROTOCOL_VERSION). A plugin manifest may
 * declare `compat` constraints (projected via plugins.ui.list). Before mounting
 * a plugin UI we check those constraints against the connected gateway so an
 * incompatible plugin renders an explanatory "needs newer gateway" panel
 * instead of an iframe whose RPC calls would fail one by one.
 *
 * Declared requirements must be verifiable; unknown constrained facts deny.
 * Unconstrained legacy plugins remain supported.
 */

export interface GatewayCapabilities {
  /** Advertised RPC method set (`hello-ok.features.methods`). */
  methods: string[];
  /** Gateway version (`hello-ok.server.version`), or null if unknown. */
  version: string | null;
  /** Bridge protocol version the host speaks (defaults to BRIDGE_PROTOCOL_VERSION). */
  bridgeProtocol?: number;
}

export type CompatVerdict = { ok: true } | { ok: false; reasons: string[] };

function validVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d+(?:\.\d+)*(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value.trim()) &&
    value
      .trim()
      .split('-')[0]
      .split('.')
      .every((part) => Number.isSafeInteger(Number(part)))
  );
}

/**
 * Compare two CalVer-ish version strings ("2026.6.0", "2026.6.14-dev").
 * Strips any `-suffix`, compares dot segments numerically. Returns -1/0/1.
 */
export function compareVersionStrings(a: string, b: string): number {
  if (!validVersion(a) || !validVersion(b)) throw new Error('invalid gateway version');
  const segments = (v: string): number[] => v.trim().split('-')[0].split('.').map(Number);
  const pa = segments(a);
  const pb = segments(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Evaluate a plugin's compat constraints against the connected gateway.
 * Returns `{ ok: true }` when every declared constraint is satisfied (or
 * absent), else `{ ok: false, reasons }` listing each failure.
 */
export function checkPluginCompat(
  compat: PluginCompat | undefined,
  caps: GatewayCapabilities,
): CompatVerdict {
  const reasons: string[] = [];
  const hostBridge = caps.bridgeProtocol ?? BRIDGE_PROTOCOL_VERSION;

  // TODO(handoff): PluginIframe currently mounts before capabilities load; admit that component,
  // manifest normalization/projection and browser/release tests before claiming end-to-end enforcement.
  // See .planning/phases/14-sdk-transport/14-PLUGIN-BRIDGE-MATRIX.md in the meta-repo.
  const min = compat?.minGatewayVersion;
  if (min !== undefined) {
    if (!validVersion(min)) reasons.push('invalid minimum gateway version');
    else if (!validVersion(caps.version)) reasons.push('gateway version is unknown or invalid');
    else if (compareVersionStrings(caps.version, min) < 0)
      reasons.push(`requires gateway ≥ ${min} (running ${caps.version})`);
  }

  const required = compat?.requiredRpc;
  if (required !== undefined) {
    if (
      !Array.isArray(required) ||
      required.some((method) => typeof method !== 'string' || !method.trim())
    )
      reasons.push('invalid required RPC methods');
    else if (required.length) {
      const have = new Set(caps.methods);
      const missing = required.filter((method) => !have.has(method));
      if (missing.length)
        reasons.push(`gateway is missing required method(s): ${missing.join(', ')}`);
    }
  }

  const bridge = compat?.bridgeProtocol;
  if (bridge !== undefined) {
    if (
      typeof bridge !== 'string' ||
      !/^[1-9]\d*$/.test(bridge.trim()) ||
      !Number.isSafeInteger(Number(bridge))
    )
      reasons.push('invalid plugin bridge protocol major');
    else if (!Number.isSafeInteger(hostBridge) || Number(bridge) !== hostBridge)
      reasons.push(`requires plugin bridge protocol ${bridge} (host speaks ${hostBridge})`);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}
