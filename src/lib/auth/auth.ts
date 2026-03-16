import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { oidcProvider } from 'better-auth/plugins';
import { organization } from 'better-auth/plugins';
import { createAuthMiddleware } from 'better-auth/api';
import { getDb } from '$server/db/client';
import * as schema from '$server/db/schema';
import { env } from '$env/dynamic/private';
import { sendInvitationEmail } from '$server/services/email.service';
import { provisionPersonalAgent } from '$server/services/personal-agent.service';

let _auth: ReturnType<typeof betterAuth> | null = null;

/** Lazy getter — safe to call at request time; never evaluates at module load. */
export function getAuth() {
	if (!_auth) {
		const hubUrl = env.BETTER_AUTH_URL ?? 'http://localhost:5173';
		_auth = betterAuth({
			database: drizzleAdapter(getDb(), { provider: 'sqlite', schema }),
			secret: env.BETTER_AUTH_SECRET,
			baseURL: hubUrl,
			trustedOrigins: [
				'http://localhost:5173',
				'http://localhost:5174',
				'http://localhost:4173',
				...(env.BETTER_AUTH_URL && env.BETTER_AUTH_URL !== 'http://localhost:5173'
					? [env.BETTER_AUTH_URL]
					: []),
				...(env.VERCEL_URL ? [`https://${env.VERCEL_URL}`] : []),
			],
			emailAndPassword: { enabled: true },
			socialProviders: {
				...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
					? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
					: {}),
			},
			plugins: [
				jwt({
					jwt: {
						issuer: hubUrl,
						audience: 'openclaw-gateway',
						expirationTime: '1h',
					},
					jwks: {
						keyPairConfig: { alg: 'EdDSA' },
					},
				}),
				oidcProvider({
					loginPage: '/login',
				}),
				organization({
					async sendInvitationEmail(data) {
						const baseUrl = env.BETTER_AUTH_URL ?? 'http://localhost:5173';
						const inviteUrl = `${baseUrl}/invite/accept?id=${data.id}`;
						await sendInvitationEmail({
							to: data.email,
							inviterName: data.inviter.user.name ?? data.inviter.user.email,
							organizationName: data.organization.name,
							role: data.role ?? 'member',
							inviteUrl,
						});
					},
				}),
			],
			hooks: {
				after: createAuthMiddleware(async (ctx) => {
					if (ctx.path.startsWith('/sign-up')) {
						const newSession = ctx.context.newSession;
						if (newSession) {
							// Create pending personal agent row synchronously (fast DB insert).
							// Gateway provisioning is async and handled separately (Plan 04).
							try {
								const db = getDb();
								const tenantCtx = { db, tenantId: 'default' };
								await provisionPersonalAgent(tenantCtx, {
									userId: newSession.user.id,
									userName: newSession.user.name ?? newSession.user.email.split('@')[0],
									serverId: '',
								});
							} catch (err) {
								// Don't block signup if personal agent creation fails
								console.error('[personal-agent] Failed to provision on signup:', err);
							}
						}
					}
				}),
			},
		});
	}
	return _auth;
}
