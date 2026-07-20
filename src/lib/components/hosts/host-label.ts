/** Gateways are assigned per org, and two orgs can be leased instances that share
 *  a name AND a URL (e.g. two `protopi-dev`). Labelling by name alone makes them
 *  indistinguishable — and picking the wrong one provisions a channel into another
 *  tenant. Qualify only the names that actually collide, so the common case stays
 *  clean, and NEVER return the same label twice: org name is the useful qualifier
 *  but it depends on page.data.organizations being present, which is not something
 *  correctness may rest on. Fall back to URL, then to a short id. */
export interface LabelHost {
  id: string;
  name: string;
  url?: string;
  orgId?: string | null;
}

export function hostLabel(
  host: LabelHost,
  all: LabelHost[],
  orgNameById: Map<string, string>,
): string {
  const collides = all.filter((x) => x.name === host.name).length > 1;
  if (!collides) return host.name;

  const org = host.orgId ? orgNameById.get(host.orgId) : null;
  if (org) return `${host.name} · ${org}`;

  const sameUrl = all.filter((x) => x.name === host.name && x.url === host.url).length > 1;
  if (!sameUrl && host.url) return `${host.name} · ${host.url.replace(/^wss?:\/\//, '')}`;

  return `${host.name} · ${host.id.slice(0, 8)}`;
}
