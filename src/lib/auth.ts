import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { organization } from 'better-auth/plugins';
import { getDb } from '$server/db/client';
import * as schema from '$server/db/schema';
import { env } from '$env/dynamic/private';

let _auth: ReturnType<typeof betterAuth> | null = null;

/** Lazy getter — safe to call at request time; never evaluates at module load. */
export function getAuth() {
	if (!_auth) {
		_auth = betterAuth({
			database: drizzleAdapter(getDb(), { provider: 'sqlite', schema }),
			secret: env.BETTER_AUTH_SECRET,
			baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:5173',
			trustedOrigins: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'],
			emailAndPassword: { enabled: true },
			socialProviders: {
				google: {
					clientId: env.GOOGLE_CLIENT_ID ?? '',
					clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
				},
			},
			plugins: [jwt(), organization()],
		});
	}
	return _auth;
}
