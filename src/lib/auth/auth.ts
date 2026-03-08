import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { organization } from 'better-auth/plugins';
import { getDb } from '$server/db/client';
import * as schema from '$server/db/schema';
import { env } from '$env/dynamic/private';
import { sendInvitationEmail } from '$server/services/email.service';

let _auth: ReturnType<typeof betterAuth> | null = null;

/** Lazy getter — safe to call at request time; never evaluates at module load. */
export function getAuth() {
	if (!_auth) {
		_auth = betterAuth({
			database: drizzleAdapter(getDb(), { provider: 'sqlite', schema }),
			secret: env.BETTER_AUTH_SECRET,
			baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:5173',
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
			jwt(),
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
		});
	}
	return _auth;
}
