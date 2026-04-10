import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertSafeUrl, SsrfBlockedError } from './ssrf-guard';

// Mock DNS so tests are hermetic and don't require real network access.
vi.mock('node:dns', () => ({
	promises: {
		lookup: vi.fn().mockImplementation(async (hostname: string) => {
			const map: Record<string, { address: string; family: number }> = {
				'public.example.com': { address: '93.184.216.34', family: 4 },
				'api.github.com': { address: '140.82.121.5', family: 4 },
				's3.us-east-005.backblazeb2.com': { address: '45.60.11.213', family: 4 },
				// Simulates DNS rebinding to AWS IMDS
				'evil-rebind.com': { address: '169.254.169.254', family: 4 },
				// Simulates a hostname resolving to an internal RFC-1918 address
				'internal.corp': { address: '10.0.1.50', family: 4 },
			};
			if (hostname in map) return map[hostname];
			throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
		}),
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// ── Blocked IPv4 addresses ────────────────────────────────────────────────────

describe('IPv4 private/reserved ranges', () => {
	it('blocks loopback 127.0.0.1', async () => {
		await expect(assertSafeUrl('http://127.0.0.1/foo')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks loopback 127.255.255.255 (edge of /8)', async () => {
		await expect(assertSafeUrl('http://127.255.255.255/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks AWS IMDS 169.254.169.254', async () => {
		await expect(
			assertSafeUrl('http://169.254.169.254/latest/meta-data/'),
		).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks ECS credentials endpoint 169.254.170.2', async () => {
		await expect(
			assertSafeUrl('http://169.254.170.2/v2/credentials'),
		).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks RFC-1918 10.0.0.0 (start of range)', async () => {
		await expect(assertSafeUrl('http://10.0.0.0/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks RFC-1918 10.1.2.3', async () => {
		await expect(assertSafeUrl('http://10.1.2.3/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks RFC-1918 10.255.255.255 (edge of /8)', async () => {
		await expect(assertSafeUrl('http://10.255.255.255/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks RFC-1918 172.16.0.1 (start of /12)', async () => {
		await expect(assertSafeUrl('http://172.16.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks RFC-1918 172.31.255.255 (edge of /12)', async () => {
		await expect(assertSafeUrl('http://172.31.255.255/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks RFC-1918 192.168.0.1', async () => {
		await expect(assertSafeUrl('http://192.168.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks RFC-1918 192.168.255.255 (edge of /16)', async () => {
		await expect(assertSafeUrl('http://192.168.255.255/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks unspecified 0.0.0.1', async () => {
		await expect(assertSafeUrl('http://0.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	// Public addresses just outside private ranges
	it('allows 172.15.0.1 (just below 172.16/12)', async () => {
		await expect(assertSafeUrl('http://172.15.0.1/')).resolves.toBeUndefined();
	});

	it('allows 172.32.0.1 (just above 172.16/12)', async () => {
		await expect(assertSafeUrl('http://172.32.0.1/')).resolves.toBeUndefined();
	});

	it('allows a legitimate public IPv4 (1.1.1.1)', async () => {
		await expect(assertSafeUrl('https://1.1.1.1/')).resolves.toBeUndefined();
	});
});

// ── Blocked IPv6 addresses ────────────────────────────────────────────────────

describe('IPv6 private/loopback ranges', () => {
	it('blocks IPv6 loopback ::1', async () => {
		await expect(assertSafeUrl('http://[::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks IPv6 link-local fe80::1', async () => {
		await expect(assertSafeUrl('http://[fe80::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks IPv6 unique-local fd00::1', async () => {
		await expect(assertSafeUrl('http://[fd00::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks IPv4-mapped IPv6 for 192.168.1.1', async () => {
		await expect(assertSafeUrl('http://[::ffff:192.168.1.1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});
});

// ── Blocked hostnames ─────────────────────────────────────────────────────────

describe('blocked hostnames', () => {
	it('blocks "localhost"', async () => {
		await expect(assertSafeUrl('http://localhost/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks "LOCALHOST" (case-insensitive)', async () => {
		await expect(assertSafeUrl('http://LOCALHOST/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});
});

// ── Blocked protocols ─────────────────────────────────────────────────────────

describe('disallowed protocols', () => {
	it('blocks file:// protocol', async () => {
		await expect(assertSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks ftp:// protocol', async () => {
		await expect(assertSafeUrl('ftp://example.com/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});
});

// ── DNS resolution / rebinding ────────────────────────────────────────────────

describe('DNS resolution checks', () => {
	it('blocks a hostname that resolves to AWS IMDS (DNS rebinding)', async () => {
		await expect(
			assertSafeUrl('http://evil-rebind.com/'),
		).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks a hostname that resolves to an RFC-1918 address', async () => {
		await expect(assertSafeUrl('http://internal.corp/')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('blocks an unresolvable hostname (NXDOMAIN)', async () => {
		await expect(
			assertSafeUrl('http://this.domain.does.not.exist.invalid/'),
		).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('allows a public hostname (api.github.com)', async () => {
		await expect(assertSafeUrl('https://api.github.com/repos/foo/bar')).resolves.toBeUndefined();
	});

	it('allows the default registry catalog URL', async () => {
		await expect(
			assertSafeUrl('https://s3.us-east-005.backblazeb2.com/minion-db/registry/catalog.json'),
		).resolves.toBeUndefined();
	});
});

// ── Invalid input ─────────────────────────────────────────────────────────────

describe('invalid input', () => {
	it('throws SsrfBlockedError for an empty string', async () => {
		await expect(assertSafeUrl('')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('throws SsrfBlockedError for a non-URL string', async () => {
		await expect(assertSafeUrl('not-a-url')).rejects.toBeInstanceOf(SsrfBlockedError);
	});
});
