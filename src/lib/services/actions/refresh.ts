/** SvelteKit can resolve invalidate() after replacing the route with an error page. */
export async function checkedRefresh(
  refresh: () => Promise<void>,
  readPage: () => { status: number; error: unknown },
): Promise<void> {
  await refresh();
  const page = readPage();
  if (page.status >= 400 || page.error != null) {
    // Keep the route boundary intact. The caller reports a committed write whose
    // projection failed; it must never replay the write to repair a failed read.
    throw new Error(`Page refresh failed (${page.status})`);
  }
}
