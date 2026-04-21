# SSRF Hardening — MCP Server Endpoints

**Status:** Implemented  
**Tracking:** [MIN-32](/MIN/issues/MIN-32)  
**Date:** 2026-04-10

## Background

Server-Side Request Forgery (SSRF) allows an attacker to coerce the server into making
HTTP requests to internal infrastructure — most critically, cloud provider Instance
Metadata Service (IMDS) endpoints such as `169.254.169.254` (AWS) and `169.254.170.2`
(ECS task credentials). A successful SSRF attack can leak IAM credentials and allow full
cloud account takeover.

Industry research found that 36.7% of publicly exposed MCP servers lack this protection.

## What Was Hardened

### 1. `assertSafeUrl` guard (`src/server/services/ssrf-guard.ts`)

A shared utility that validates any URL before the server uses it as a fetch/WebSocket
target. It rejects:

| Category                 | Examples                                                     |
| ------------------------ | ------------------------------------------------------------ |
| Loopback                 | `127.0.0.0/8`, `::1`                                         |
| RFC-1918 private         | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`              |
| Link-local / IMDS        | `169.254.0.0/16` (incl. `169.254.169.254`, `169.254.170.2`)  |
| Shared address space     | `100.64.0.0/10` (RFC 6598 carrier-grade NAT)                 |
| IPv6 loopback/link-local | `::1`, `fe80::/10`, `fc00::/7`                               |
| IPv4-mapped IPv6         | `::ffff:192.168.x.x` (both dotted and WHATWG hex form)       |
| Disallowed protocols     | `file://`, `ftp://`, etc. (only `http/https/ws/wss` allowed) |
| Unresolvable hostnames   | NXDOMAIN / SERVFAIL — blocked to prevent SSRF via typosquat  |
| DNS rebinding            | Hostname resolves to private IP at validation time           |

### 2. Endpoints protected

| Endpoint                    | File                                         | Attack vector before fix                               |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `GET /api/registry/catalog` | `src/routes/api/registry/catalog/+server.ts` | `REGISTRY_CATALOG_URL` env var could point to IMDS     |
| `GET /api/registry/version` | `src/routes/api/registry/version/+server.ts` | `REGISTRY_INDEX_URL` env var could point to IMDS       |
| `POST /api/servers`         | `src/routes/api/servers/+server.ts`          | User-supplied server URL stored and used for WebSocket |

### 3. Test coverage

`src/server/services/ssrf-guard.test.ts` — 30 tests covering:

- All RFC-1918 range boundaries (start, middle, edge)
- AWS IMDS `169.254.169.254` and ECS `169.254.170.2`
- IPv6 loopback, link-local, unique-local
- IPv4-mapped IPv6 (both dotted and WHATWG-normalized hex forms)
- DNS rebinding simulation (mock `dns.lookup` returns private IP)
- NXDOMAIN / unresolvable hostname
- Disallowed protocols (`file://`, `ftp://`)
- Allowlist validation for real public URLs (Backblaze B2, GitHub API)
- Public addresses just outside private ranges to verify no false positives

## Remaining Gaps / Future Work

1. **DNS rebinding at fetch time (TOCTOU):** `assertSafeUrl` resolves DNS once before
   fetching. A sophisticated attacker with control over a DNS server could serve a
   public IP for validation, then switch to a private IP for the actual fetch. Full
   mitigation requires a custom `undici` dispatcher that pins the resolved IP for the
   lifetime of the connection. Acceptable risk for current threat model; revisit if
   Minion Hub is deployed in a high-value cloud environment.

2. **WebSocket URL validation on connect:** The client-side `gateway.svelte.ts` opens
   WebSocket connections to stored server URLs. Because this happens in the browser
   (not server-side), the `assertSafeUrl` guard at storage time (`POST /api/servers`)
   is the primary control. Browser same-origin and CSP policies provide additional
   defence.

3. **`REGISTRY_CATALOG_PATH` local file reads:** The catalog endpoint also supports a
   `REGISTRY_CATALOG_PATH` env var that reads a local file. This is only safe if the
   file path is set by the deployment operator (not user-controlled) and the container
   filesystem is read-only. No change made — this is an operator configuration concern.

## Runbook: Responding to an SSRF Attempt

1. **Detect:** Look for `SsrfBlockedError` in application logs with the pattern
   `"Blocked private IP"`, `"Blocked hostname"`, or `"Cannot resolve hostname"`.

2. **Triage:** Determine whether the URL came from:
   - A user POST to `/api/servers` → potential malicious actor; review account and
     revoke session.
   - An environment variable → potential misconfiguration or supply-chain compromise;
     audit deployment pipeline.

3. **Escalate:** Critical findings go to the CTO and on-call security responder.

4. **Rotate credentials:** If IMDS was targeted, rotate all IAM credentials associated
   with the host even if the attempt was blocked — the attempt indicates recon activity.
