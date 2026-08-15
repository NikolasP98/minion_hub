import { encrypt, decrypt } from '../auth/crypto';

// clientSecret rides along for OAuth-style providers (sunat-sire); JSON round-trip keeps it.
export type FinanceCreds = { username: string; password: string; clientSecret?: string };

export function encryptCreds(c: FinanceCreds): { ciphertext: string; iv: string } {
  return encrypt(JSON.stringify(c));
}

export function decryptCreds(ciphertext: string, iv: string): FinanceCreds {
  return JSON.parse(decrypt(ciphertext, iv)) as FinanceCreds;
}
