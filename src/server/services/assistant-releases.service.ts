import { error } from '@sveltejs/kit';
import { listReleases } from './releases/releases.service';

/** On-demand public app content; bounded separately from the full changelog page. */
export async function assistantReleases(limit = 5) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw error(400, 'limit: expected integer 1..20');
  const releases = await listReleases();
  let contentTruncated = false;
  let remaining = 16_000;
  const clip = (value: string, size: number) => {
    const bound = Math.min(size, remaining);
    if (value.length > bound) contentTruncated = true;
    const result = value.slice(0, bound);
    remaining -= result.length;
    return result;
  };
  const identity = (value: string, size: number) => {
    if (value.length > size) contentTruncated = true;
    return value.slice(0, size);
  };
  const bounded = releases.slice(0, limit).map((r) => {
    const sections: Record<string, Record<string, string[]>> = {};
    const labels = Object.entries(r.sections ?? {});
    if (labels.length > 10) contentTruncated = true;
    for (const [label, scopes] of labels.slice(0, 10)) {
      if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) {
        contentTruncated = true;
        continue;
      }
      const entries = Object.entries(scopes);
      if (entries.length > 10) contentTruncated = true;
      const section: Record<string, string[]> = {};
      for (const [scope, notes] of entries.slice(0, 10)) {
        if (!Array.isArray(notes)) {
          contentTruncated = true;
          continue;
        }
        if (notes.some((n) => typeof n !== 'string')) contentTruncated = true;
        if (notes.length > 20) contentTruncated = true;
        section[clip(scope, 100)] = notes
          .filter((n): n is string => typeof n === 'string')
          .slice(0, 20)
          .map((n) => clip(n, 1000));
      }
      sections[clip(label, 100)] = section;
    }
    const prs = (Array.isArray(r.prs) ? r.prs : []).filter(
      (p): p is { number: number; title: string; url: string } =>
        !!p &&
        typeof p === 'object' &&
        Number.isSafeInteger(p.number) &&
        p.number > 0 &&
        typeof p.title === 'string' &&
        p.url === `https://github.com/NikolasP98/minion_hub/pull/${p.number}`,
    );
    if (Array.isArray(r.prs) && prs.length !== r.prs.length) contentTruncated = true;
    if (prs.length > 20) contentTruncated = true;
    return {
      version: identity(r.version, 100),
      releasedAt: r.releasedAt,
      sections,
      prs: prs
        .slice(0, 20)
        .map((p) => ({ number: p.number, title: clip(p.title, 500), url: p.url })),
    };
  });
  return {
    product: 'Minion Hub',
    source: 'hub_app_releases',
    href: '/changelog',
    releases: bounded,
    total: releases.length,
    returned: bounded.length,
    truncated: releases.length > bounded.length,
    contentTruncated,
    installedGatewayVersion: 'not_queried',
  };
}
