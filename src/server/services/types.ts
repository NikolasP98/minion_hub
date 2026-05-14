/**
 * Shared types for server-side load helpers.
 *
 * `LoadCtx` is the narrow slice of `App.Locals` that load-helper service
 * functions need. It is intentionally a `Pick` of `App.Locals` so the same
 * value can be passed from both an API `+server.ts` handler and a SvelteKit
 * `+layout.server.ts` load — both receive `event.locals` shaped like this.
 *
 * `paperclipIdentity` is included because the workspaces helper needs it
 * to call into paperclip; it is populated by `paperclipIdentityHandle` in
 * `hooks.server.ts`.
 */
export type LoadCtx = Pick<
  App.Locals,
  'tenantCtx' | 'user' | 'session' | 'paperclipIdentity'
>;
