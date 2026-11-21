import { describe, expect, it } from 'vitest';
import {
  hashSecret,
  isLoopbackRedirect,
  metadata,
  newSecret,
  pkceOk,
  redirectMatches,
  wellKnownDocument,
  resourceMatches,
  cleanAppName,
} from './oauth-logic';

describe('isLoopbackRedirect', () => {
  it.each(['http://localhost:1234/cb', 'http://127.0.0.1/cb', 'http://[::1]:9/cb'])(
    'accepts %s',
    (uri) => expect(isLoopbackRedirect(uri)).toBe(true),
  );
  it.each([
    'https://evil.test',
    'https://localhost/cb',
    'http://localhost.evil.test/cb',
    'http://localhost./cb',
    'http://127.1/cb',
    'http://[::ffff:127.0.0.1]/cb',
    'http://0.0.0.0/cb',
    'http://LOCALHOST/cb',
    'http://127.0.0.1.evil.test/cb',
    `http://localhost/${'a'.repeat(200)}`,
    'http://127.0.0.1@evil.test/cb',
    'http://user:pw@localhost/cb',
    'myapp://callback',
    'http://localhost/cb#frag',
    'not a url',
    '',
  ])('rejects %s', (uri) => expect(isLoopbackRedirect(uri)).toBe(false));
  it('rejects a non-string', () => expect(isLoopbackRedirect(42)).toBe(false));
});

describe('redirectMatches', () => {
  const registered = ['http://localhost:3118/callback', 'https://never.test/x'];
  it('matches exactly', () => expect(redirectMatches(registered[0]!, registered)).toBe(true));
  it('ignores the port on loopback only', () => {
    expect(redirectMatches('http://localhost:60001/callback', registered)).toBe(true);
    expect(redirectMatches('http://localhost:60001/other', registered)).toBe(false);
    expect(redirectMatches('http://127.0.0.1:3118/callback', registered)).toBe(false);
    expect(redirectMatches('https://never.test:444/x', registered)).toBe(false);
  });
});

describe('pkceOk (RFC 7636 appendix B)', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  it('accepts the vector', () => expect(pkceOk(verifier, challenge)).toBe(true));
  it('rejects a wrong verifier, a short one and a wrong challenge', () => {
    expect(pkceOk(verifier.replace('d', 'e'), challenge)).toBe(false);
    expect(pkceOk('short', challenge)).toBe(false);
    expect(pkceOk(verifier, challenge.slice(0, -1) + 'A')).toBe(false);
  });
});

describe('secrets and metadata', () => {
  it('generates prefixed, distinct secrets and hashes them to sha256 hex', () => {
    const a = newSecret('mcp_at_');
    expect(a).toMatch(/^mcp_at_[A-Za-z0-9_-]{43}$/);
    expect(newSecret('mcp_at_')).not.toBe(a);
    expect(hashSecret(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(a)).not.toContain(a);
  });
  it('builds both documents from the origin', () => {
    const m = metadata('https://hub.test');
    expect(m.protectedResource).toEqual({
      resource: 'https://hub.test/api/mcp',
      authorization_servers: ['https://hub.test'],
      bearer_methods_supported: ['header'],
    });
    expect(m.authorizationServer).toMatchObject({
      issuer: 'https://hub.test',
      authorization_endpoint: 'https://hub.test/oauth/authorize',
      token_endpoint: 'https://hub.test/api/oauth/token',
      registration_endpoint: 'https://hub.test/api/oauth/register',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe('wellKnownDocument', () => {
  it('serves the three exact paths and nothing else', () => {
    const o = 'https://hub.test';
    expect(wellKnownDocument('/.well-known/oauth-protected-resource/api/mcp', o)).toEqual(
      metadata(o).protectedResource,
    );
    expect(wellKnownDocument('/.well-known/oauth-protected-resource', o)).toEqual(
      metadata(o).protectedResource,
    );
    expect(wellKnownDocument('/.well-known/oauth-authorization-server', o)).toEqual(
      metadata(o).authorizationServer,
    );
    expect(wellKnownDocument('/.well-known/oauth-authorization-server/x', o)).toBeNull();
    expect(wellKnownDocument('/.well-known/jwks.json', o)).toBeNull();
  });
});

describe('resourceMatches / cleanAppName', () => {
  it('compares the resource after URL normalisation', () => {
    expect(resourceMatches('https://hub.test/api/mcp', 'https://hub.test')).toBe(true);
    expect(resourceMatches('HTTPS://HUB.test:443/api/mcp', 'https://hub.test')).toBe(true);
    expect(resourceMatches('https://hub.test/api/mcp/', 'https://hub.test')).toBe(false);
    expect(resourceMatches('https://other.test/api/mcp', 'https://hub.test')).toBe(false);
    expect(resourceMatches('not a url', 'https://hub.test')).toBe(false);
  });
  it('strips control and bidirectional characters from a name', () => {
    expect(cleanAppName('  Cl\u202eaude\u200f\u0007 Code ')).toBe('Claude Code');
  });
});
