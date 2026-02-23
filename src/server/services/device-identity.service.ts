import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { deviceIdentities } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlEncode(buf: Buffer): string {
	return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
	const key = crypto.createPublicKey(publicKeyPem);
	const spki = key.export({ type: 'spki', format: 'der' }) as Buffer;
	if (
		spki.length === ED25519_SPKI_PREFIX.length + 32 &&
		spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
	) {
		return spki.subarray(ED25519_SPKI_PREFIX.length);
	}
	return spki;
}

function generateIdentity() {
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
	const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
	const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
	const raw = derivePublicKeyRaw(publicKeyPem);
	const deviceId = crypto.createHash('sha256').update(raw).digest('hex');
	return { deviceId, publicKeyPem, privateKeyPem };
}

export interface DeviceIdentity {
	deviceId: string;
	publicKeyPem: string;
	privateKeyPem: string;
	publicKeyB64: string;
}

export async function getOrCreateIdentity(ctx: TenantContext): Promise<DeviceIdentity> {
	const rows = await ctx.db
		.select({
			deviceId: deviceIdentities.deviceId,
			publicKeyPem: deviceIdentities.publicKeyPem,
			privateKeyPem: deviceIdentities.privateKeyPem,
		})
		.from(deviceIdentities)
		.where(eq(deviceIdentities.tenantId, ctx.tenantId))
		.limit(1);

	if (rows.length > 0) {
		const row = rows[0];
		return {
			deviceId: row.deviceId,
			publicKeyPem: row.publicKeyPem,
			privateKeyPem: row.privateKeyPem,
			publicKeyB64: base64UrlEncode(derivePublicKeyRaw(row.publicKeyPem)),
		};
	}

	const identity = generateIdentity();
	await ctx.db.insert(deviceIdentities).values({
		id: newId(),
		tenantId: ctx.tenantId,
		deviceId: identity.deviceId,
		publicKeyPem: identity.publicKeyPem,
		privateKeyPem: identity.privateKeyPem,
		createdAt: nowMs(),
	});

	return {
		deviceId: identity.deviceId,
		publicKeyPem: identity.publicKeyPem,
		privateKeyPem: identity.privateKeyPem,
		publicKeyB64: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
	};
}

function buildDeviceAuthPayload(params: {
	deviceId: string;
	clientId: string;
	clientMode: string;
	role: string;
	scopes: string[];
	signedAtMs: number;
	token?: string | null;
	nonce?: string | null;
}): string {
	const version = params.nonce ? 'v2' : 'v1';
	const base = [
		version,
		params.deviceId,
		params.clientId,
		params.clientMode,
		params.role,
		params.scopes.join(','),
		String(params.signedAtMs),
		params.token ?? '',
	];
	if (version === 'v2') {
		base.push(params.nonce ?? '');
	}
	return base.join('|');
}

export interface SignParams {
	nonce?: string | null;
	token?: string | null;
	role?: string;
	scopes?: string[];
	clientId?: string;
	clientMode?: string;
}

export function signDeviceAuth(identity: DeviceIdentity, params: SignParams) {
	const signedAtMs = Date.now();
	const payload = buildDeviceAuthPayload({
		deviceId: identity.deviceId,
		clientId: params.clientId ?? 'minion-control-ui',
		clientMode: params.clientMode ?? 'ui',
		role: params.role ?? 'operator',
		scopes: params.scopes ?? ['operator.admin'],
		signedAtMs,
		token: params.token ?? null,
		nonce: params.nonce ?? null,
	});

	const key = crypto.createPrivateKey(identity.privateKeyPem);
	const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key);
	const signature = base64UrlEncode(sig);

	return {
		id: identity.deviceId,
		publicKey: identity.publicKeyB64,
		signature,
		signedAt: signedAtMs,
		nonce: params.nonce ?? undefined,
	};
}
