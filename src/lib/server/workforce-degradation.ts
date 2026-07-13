/** Native project and Inbox shells can render without the execution backend. */
export function canRenderWithoutWorkforce(pathname: string): boolean {
  return (
    pathname === '/workforce/inbox' ||
    pathname === '/workforce/projects' ||
    /^\/workforce\/projects\/[^/]+\/?$/.test(pathname)
  );
}
