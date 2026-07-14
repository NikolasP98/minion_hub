/** Routes that need a signed, active-org Workforce identity in hooks.server. */
export function needsWorkforceIdentity(pathname: string): boolean {
  return (
    pathname === '/work' ||
    pathname.startsWith('/workforce') ||
    pathname.startsWith('/api/workforce') ||
    pathname.startsWith('/api/pc') ||
    pathname.startsWith('/agents/autonomous')
  );
}
