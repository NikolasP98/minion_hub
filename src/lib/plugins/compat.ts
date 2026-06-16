import { BRIDGE_PROTOCOL_VERSION } from "./bridge-protocol";
import type { PluginCompat } from "./plugin-types";

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
 * All checks are permissive when the relevant fact is unknown (missing gateway
 * version, no advertised methods yet) — we only block on a *positive* mismatch.
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

/**
 * Compare two CalVer-ish version strings ("2026.6.0", "2026.6.14-dev").
 * Strips any `-suffix`, compares dot segments numerically. Returns -1/0/1.
 */
export function compareVersionStrings(a: string, b: string): number {
  const segments = (v: string): number[] =>
    v
      .trim()
      .split("-")[0]
      .split(".")
      .map((p) => {
        const n = Number.parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });
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
 * absent / not checkable), else `{ ok: false, reasons }` listing each failure.
 */
export function checkPluginCompat(
  compat: PluginCompat | undefined,
  caps: GatewayCapabilities,
): CompatVerdict {
  const reasons: string[] = [];
  const hostBridge = caps.bridgeProtocol ?? BRIDGE_PROTOCOL_VERSION;

  const min = compat?.minGatewayVersion?.trim();
  if (min && caps.version) {
    if (compareVersionStrings(caps.version, min) < 0) {
      reasons.push(`requires gateway ≥ ${min} (running ${caps.version})`);
    }
  }

  const required = compat?.requiredRpc;
  if (required && required.length > 0 && caps.methods.length > 0) {
    const have = new Set(caps.methods);
    const missing = required.filter((m) => !have.has(m));
    if (missing.length > 0) {
      reasons.push(`gateway is missing required method(s): ${missing.join(", ")}`);
    }
  }

  const bridge = compat?.bridgeProtocol?.trim();
  if (bridge) {
    const need = Number.parseInt(bridge, 10);
    if (Number.isFinite(need) && need > hostBridge) {
      reasons.push(`requires plugin bridge protocol ≥ ${need} (host speaks ${hostBridge})`);
    }
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}
