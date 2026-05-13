import { promises as dns } from 'node:dns';

/**
 * Operator opt-in: comma-separated DNS suffixes that bypass the SSRF guard
 * entirely. Use for trusted private namespaces with their own auth/encryption
 * (e.g. Tailscale `.ts.net`). Matched case-insensitively against the URL hostname.
 *
 * Example: `SSRF_ALLOWED_HOSTNAME_SUFFIXES=.ts.net,corp.internal`
 *
 * Read from `process.env` (not `$env/dynamic/private`) so this module is
 * testable under vitest without SvelteKit module resolution.
 */
function allowedHostnameSuffixes(): string[] {
  const raw = process.env.SSRF_ALLOWED_HOSTNAME_SUFFIXES ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Operator opt-in: when `SSRF_ALLOW_TAILSCALE_CGNAT=true`, the carrier-grade NAT
 * range 100.64.0.0/10 is allowed for literal-IP URLs and for hostnames that
 * resolve to a CGNAT IP. Pair with the hostname allowlist for namespaces like
 * Tailscale where the resolved IP will be in this block.
 */
function allowTailscaleCgnat(): boolean {
  return process.env.SSRF_ALLOW_TAILSCALE_CGNAT === 'true';
}

/**
 * IPv4 CIDR ranges that must never be the target of a proxied fetch/WebSocket.
 * Covers: loopback, RFC-1918, link-local (AWS IMDS 169.254.169.254,
 * ECS credentials 169.254.170.2), shared address space, and reserved blocks.
 */
type CidrRange = { start: [number, number, number, number]; prefixLen: number };

// Shared address space / carrier-grade NAT (RFC 6598). Tailscale assigns
// endpoint IPs from this block — opt-in unblock via SSRF_ALLOW_TAILSCALE_CGNAT.
const TAILSCALE_CGNAT_RANGE: CidrRange = { start: [100, 64, 0, 0], prefixLen: 10 };

const BLOCKED_IPV4_RANGES: CidrRange[] = [
  // Loopback
  { start: [127, 0, 0, 0], prefixLen: 8 },
  // RFC-1918 private
  { start: [10, 0, 0, 0], prefixLen: 8 },
  { start: [172, 16, 0, 0], prefixLen: 12 },
  { start: [192, 168, 0, 0], prefixLen: 16 },
  // Link-local — includes AWS IMDS 169.254.169.254 and ECS creds 169.254.170.2
  { start: [169, 254, 0, 0], prefixLen: 16 },
  // Unspecified / "this" network
  { start: [0, 0, 0, 0], prefixLen: 8 },
  // Shared address space / carrier-grade NAT (RFC 6598) — see TAILSCALE_CGNAT_RANGE
  TAILSCALE_CGNAT_RANGE,
  // IETF Protocol Assignments
  { start: [192, 0, 0, 0], prefixLen: 24 },
  // Documentation / TEST-NET
  { start: [192, 0, 2, 0], prefixLen: 24 },
  { start: [198, 51, 100, 0], prefixLen: 24 },
  { start: [203, 0, 113, 0], prefixLen: 24 },
  // Benchmarking
  { start: [198, 18, 0, 0], prefixLen: 15 },
  // Reserved / Class E
  { start: [240, 0, 0, 0], prefixLen: 4 },
];

function ipv4ToUint32(octets: [number, number, number, number]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  const addr = ipv4ToUint32(parts as [number, number, number, number]);
  const cgnatAllowed = allowTailscaleCgnat();
  for (const range of BLOCKED_IPV4_RANGES) {
    if (cgnatAllowed && range === TAILSCALE_CGNAT_RANGE) continue;
    const shift = 32 - range.prefixLen;
    if (addr >>> shift === ipv4ToUint32(range.start) >>> shift) return true;
  }
  return false;
}

function hostnameIsAllowlisted(host: string): boolean {
  const lower = host.toLowerCase();
  for (const suffix of allowedHostnameSuffixes()) {
    if (suffix.startsWith('.')) {
      if (lower.endsWith(suffix) || lower === suffix.slice(1)) return true;
    } else {
      if (lower === suffix || lower.endsWith(`.${suffix}`)) return true;
    }
  }
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  // Loopback
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(h) || h.startsWith('fe80:')) return true;
  // Unique-local fc00::/7
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv4-mapped — dotted-decimal form: ::ffff:a.b.c.d
  const mappedDotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isBlockedIpv4(mappedDotted[1]);
  // IPv4-mapped — WHATWG-normalized hex form: ::ffff:xxyy:zzww
  const mappedHex = h.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isBlockedIpv4(ipv4);
  }
  return false;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback', 'broadcasthost']);

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Asserts that a URL does not target private, link-local, or reserved
 * network ranges. For hostname-based URLs, performs a DNS lookup so that
 * DNS-rebinding attacks are also caught.
 *
 * Throws {@link SsrfBlockedError} for any blocked target.
 * Throws {@link SsrfBlockedError} when the hostname cannot be resolved
 * (NXDOMAIN / SERVFAIL), to avoid leaking requests to unresolvable targets.
 */
export async function assertSafeUrl(rawUrl: string, context = 'URL'): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Invalid ${context}: cannot parse URL`);
  }

  const { hostname, protocol } = parsed;

  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new SsrfBlockedError(`Disallowed protocol "${protocol}" in ${context}`);
  }

  // Strip IPv6 brackets added by URL parser
  const host = hostname.replace(/^\[|\]$/g, '');

  // Block well-known internal hostnames before any DNS lookup
  if (BLOCKED_HOSTNAMES.has(host.toLowerCase())) {
    throw new SsrfBlockedError(`Blocked hostname "${host}" in ${context}`);
  }

  // Operator allowlist: trusted suffixes (e.g. `.ts.net` for Tailscale) bypass
  // both literal-IP and DNS-resolved private-range checks. Use only for
  // namespaces with their own auth/encryption layer.
  if (hostnameIsAllowlisted(host)) {
    return;
  }

  const ipv4Pattern = /^\d+\.\d+\.\d+\.\d+$/;
  if (ipv4Pattern.test(host)) {
    if (isBlockedIpv4(host)) {
      throw new SsrfBlockedError(`Blocked private IP address "${host}" in ${context}`);
    }
    return;
  }

  // IPv6 literal (contains colon after bracket-stripping)
  if (host.includes(':')) {
    if (isBlockedIpv6(host)) {
      throw new SsrfBlockedError(`Blocked private IPv6 address "${host}" in ${context}`);
    }
    return;
  }

  // Hostname — resolve and verify the resulting IP is public.
  // This also catches DNS-rebinding attacks.
  try {
    const { address, family } = await dns.lookup(host);
    if (family === 4 && isBlockedIpv4(address)) {
      throw new SsrfBlockedError(
        `Hostname "${host}" resolves to blocked private IP "${address}" in ${context}`,
      );
    }
    if (family === 6 && isBlockedIpv6(address)) {
      throw new SsrfBlockedError(
        `Hostname "${host}" resolves to blocked private IPv6 "${address}" in ${context}`,
      );
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err;
    // DNS resolution failed (NXDOMAIN, timeout, etc.) — block to be safe
    throw new SsrfBlockedError(
      `Cannot resolve hostname "${host}" in ${context}: ${(err as Error).message}`,
    );
  }
}
