// NOTE: auth.ts uses $env/dynamic/private (server-only) so cannot be
// re-exported through a barrel that client code imports.
// Server code: import from '$lib/auth/auth'
// Client code: import from '$lib/auth/auth-client'
export * from './auth-client';
