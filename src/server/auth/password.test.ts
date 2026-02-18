import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('produces an argon2 hash string', async () => {
    const hashed = await hashPassword('test-password');
    expect(hashed).toMatch(/^\$argon2/);
  });

  it('produces unique hashes (different salts)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });

  it('verifies correct password', async () => {
    const hashed = await hashPassword('correct-horse');
    expect(await verifyPassword(hashed, 'correct-horse')).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hashed = await hashPassword('correct-horse');
    expect(await verifyPassword(hashed, 'wrong-horse')).toBe(false);
  });
});
