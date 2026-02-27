import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { organization } from 'better-auth/plugins';
import { getDb } from '$server/db/client';
import { env } from '$env/dynamic/private';

export const auth = betterAuth({
	database: drizzleAdapter(getDb(), {
		provider: 'sqlite',
	}),
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:5173',
	emailAndPassword: {
		enabled: true,
	},
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID ?? '',
			clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
		},
	},
	plugins: [jwt(), organization()],
});
