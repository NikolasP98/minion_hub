/** Native Projects owns its data in Hub and can render without the execution backend. */
export function canRenderWithoutWorkforce(pathname: string): boolean {
  return pathname === '/workforce/projects' || /^\/workforce\/projects\/[^/]+\/?$/.test(pathname);
}
