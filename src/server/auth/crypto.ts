import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function getEncryptionKey(): Buffer {
	const raw = process.env.ENCRYPTION_KEY || 'minion-hub-dev-key';
	return scryptSync(raw, 'minion-hub-salt', 32);
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
	if (!cachedKey) cachedKey = getEncryptionKey();
	return cachedKey;
}

export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key(), iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	// Store ciphertext + authTag together
	const combined = Buffer.concat([encrypted, authTag]);
	return { ciphertext: combined.toString('hex'), iv: iv.toString('hex') };
}

export function decrypt(ciphertext: string, iv: string): string {
	const ivBuf = Buffer.from(iv, 'hex');
	const combined = Buffer.from(ciphertext, 'hex');
	// Last 16 bytes are the auth tag
	const encrypted = combined.subarray(0, combined.length - AUTH_TAG_BYTES);
	const authTag = combined.subarray(combined.length - AUTH_TAG_BYTES);
	const decipher = createDecipheriv(ALGORITHM, key(), ivBuf);
	decipher.setAuthTag(authTag);
	return decipher.update(encrypted) + decipher.final('utf8');
}

export function encryptToken(token: string): { encrypted: string; iv: string } {
	const { ciphertext, iv } = encrypt(token);
	return { encrypted: ciphertext, iv };
}

export function decryptToken(encrypted: string, iv: string): string {
	return decrypt(encrypted, iv);
}
