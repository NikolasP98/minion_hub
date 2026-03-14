import { eq, desc } from 'drizzle-orm';
import { SignJWT, importJWK } from 'jose';
import { user, userAgents, jwks } from '$server/db/schema';
import { getDb } from '$server/db/client';
import { env } from '$env/dynamic/private';
import type { TenantContext } from './base';

/** Claims included in the gateway JWT payload. */
export interface GatewayJwtClaims {
	userId: string;
	role: 'admin' | 'user';
	agentIds: string[];
	orgId: string | null;
}

/** JWT expiration time in seconds (1 hour). */
const JWT_EXPIRY_SECONDS = 3600;

/**
 * Issue a gateway JWT with custom claims for the specified user.
 *
 * Signs the token directly using jose with the JWKS keys stored by
 * Better Auth's JWT plugin. The token includes userId, role, agentIds,
 * and orgId as custom claims.
 */
export async function issueGatewayJwt(
	ctx: TenantContext,
	userId: string,
): Promise<{ token: string; expiresAt: number }> {
	// 1. Look up user to get role
	const [dbUser] = await ctx.db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!dbUser) {
		throw new Error(`User not found: ${userId}`);
	}

	// 2. Fetch agent IDs assigned to this user (across all servers in the tenant)
	const agentRows = await ctx.db
		.select({ agentId: userAgents.agentId })
		.from(userAgents)
		.where(eq(userAgents.userId, userId));

	const agentIds = [...new Set(agentRows.map((r) => r.agentId))];

	// 3. Get the latest JWKS private key from the database
	const db = getDb();
	const [latestKey] = await db
		.select({
			id: jwks.id,
			privateKey: jwks.privateKey,
		})
		.from(jwks)
		.orderBy(desc(jwks.createdAt))
		.limit(1);

	if (!latestKey) {
		throw new Error('No JWKS key pair found. Visit /api/auth/jwks to initialize keys.');
	}

	// Better Auth encrypts private keys by default using the auth secret.
	// We need to decrypt it. Import the symmetricDecrypt function.
	const { symmetricDecrypt } = await import('better-auth/crypto');
	const secret = env.BETTER_AUTH_SECRET ?? '';
	let privateKeyJwk: string;
	try {
		privateKeyJwk = await symmetricDecrypt({
			key: secret,
			data: JSON.parse(latestKey.privateKey),
		});
	} catch {
		// If decryption fails, the key may not be encrypted (disablePrivateKeyEncryption)
		privateKeyJwk = latestKey.privateKey;
	}

	const alg = 'EdDSA';
	const privateKey = await importJWK(JSON.parse(privateKeyJwk), alg);

	// 4. Sign the JWT
	const nowSeconds = Math.floor(Date.now() / 1000);
	const expiresAt = (nowSeconds + JWT_EXPIRY_SECONDS) * 1000; // ms for the client
	const hubUrl = env.BETTER_AUTH_URL ?? 'http://localhost:5173';

	const claims: GatewayJwtClaims = {
		userId: dbUser.id,
		role: dbUser.role as 'admin' | 'user',
		agentIds,
		orgId: ctx.tenantId,
	};

	const token = await new SignJWT({ ...claims })
		.setProtectedHeader({ alg, kid: latestKey.id })
		.setSubject(dbUser.id)
		.setIssuedAt(nowSeconds)
		.setExpirationTime(nowSeconds + JWT_EXPIRY_SECONDS)
		.setIssuer(hubUrl)
		.setAudience('openclaw-gateway')
		.sign(privateKey);

	return { token, expiresAt };
}
