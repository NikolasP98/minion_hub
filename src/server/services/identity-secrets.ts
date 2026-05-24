import { encrypt, decrypt } from '$server/auth/crypto';

/** Google Application Default Credentials (authorized_user) blob. */
export type GoogleAdc = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  type: 'authorized_user';
};

export function encryptAdc(adc: GoogleAdc): { ciphertext: string; iv: string } {
  return encrypt(JSON.stringify(adc));
}

export function decryptAdc(ciphertext: string, iv: string): GoogleAdc {
  return JSON.parse(decrypt(ciphertext, iv)) as GoogleAdc;
}
