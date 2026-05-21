import { createAuth, type AuthInstance } from '@minion-stack/auth';
import { oidcProvider, organization } from 'better-auth/plugins';
import { createAuthMiddleware } from 'better-auth/api';
import { getDb } from '$server/db/client';
import * as schema from '@minion-stack/db/schema';
import { env } from '$env/dynamic/private';
import { sendInvitationEmail } from '$server/services/email.service';
import { provisionPersonalAgent } from '$server/services/personal-agent.service';

let _auth: AuthInstance | null = null;

/** Lazy getter — safe to call at request time; never evaluates env at module load. */
export function getAuth(): AuthInstance {
	if (!_auth) {
		const hubUrl = env.BETTER_AUTH_URL ?? 'http://localhost:5173';

		_auth = createAuth({
			db: getDb(),
			schema,
			secret: env.BETTER_AUTH_SECRET ?? '',
			baseURL: hubUrl,
			trustedOrigins: [
				...(env.VERCEL_URL ? [`https://${env.VERCEL_URL}`] : []),
				// Desktop (Tauri) shell: webview navigates to the local Node sidecar.
				// Add both host spellings so it doesn't matter whether the loader
				// redirected to localhost or 127.0.0.1.
				...(env.DESKTOP === '1'
					? [
							'http://localhost:5959',
							'http://127.0.0.1:5959',
							// Tauri webview's own origin on macOS/Linux (asset protocol)
							'tauri://localhost',
							// Tauri webview's origin on Windows
							'https://tauri.localhost',
						]
					: []),
			],
			google:
				env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
					? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
					: undefined,
			plugins: [
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
				oidcProvider({
					loginPage: '/login',
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
									email: newSession.user.email,
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
