// Exercise the installed SvelteKit matcher/decoder used by respond.js, rather
// than copying its percent-decoding algorithm into the regression suite.
type ParsedRoute = { pattern: RegExp; params: unknown[] };
const routing = (await import(
  `${process.cwd()}/node_modules/@sveltejs/kit/src/utils/routing.js`
)) as {
  parse_route_id(id: string): ParsedRoute;
  find_route(
    path: string,
    routes: ParsedRoute[],
    matchers: Record<string, never>,
  ): {
    params: Record<string, string>;
  } | null;
};
const urls = (await import(`${process.cwd()}/node_modules/@sveltejs/kit/src/utils/url.js`)) as {
  decode_pathname(path: string): string;
};

export function kitParams(route: string, href: string): Record<string, string> | undefined {
  const pathname = new URL(href, 'https://fixture.invalid').pathname;
  return routing.find_route(urls.decode_pathname(pathname), [routing.parse_route_id(route)], {})
    ?.params;
}
