import { canonicalPath } from '$lib/canonical-path';
import { getModules } from './modules';
import {
  aliasableTargets,
  EMPTY_NAV_CONFIG,
  resolveNavInstance,
  type NavConfig,
} from './custom-sections';
import { routeAccessPolicyIdForPath } from '$lib/routes/route-access-policies';

export interface SectionAccessChoice {
  target: string;
  label: string;
}
const MODULE_KEYS = new Set([
  'overview',
  'crm',
  'finance',
  'sales',
  'scheduling',
  'support',
  'projects',
  'memberships',
  'comms',
  'brains',
  'stock',
  'ads',
  'pos',
  'pulse',
  'agents',
  'channels',
  'flows',
  'marketplace',
  'reliability',
  'workspace',
  'settings',
  'users',
  'tools',
]);
const ALIASES: Record<string, string> = {
  finances: 'finance',
  socials: 'ads',
  workforce: 'projects',
  work: 'projects',
  team: 'users',
  sessions: 'agents',
  skills: 'agents',
  cloud: 'workspace',
  home: 'overview',
  overview: 'overview',
};
function pathname(href: string): string {
  return canonicalPath(href.split(/[?#]/, 1)[0]);
}
/** Canonical data policy for one native nav screen; headings never fan out a grant. */
function moduleTarget(href: string): string | null {
  const path = pathname(href);
  // These authenticated shells have no overview capability route gate. Their
  // functional access control is the registered native-page visibility rule.
  if (path === '/home' || path === '/overview') return `page:${path}`;
  const policy = routeAccessPolicyIdForPath(path);
  const match = /^(?:permission|capability|org-capability):([^:]+):/.exec(policy);
  const key = (match?.[1] ?? '').split('.')[0];
  if (MODULE_KEYS.has(key)) return key;
  const first = path.split('/')[1] ?? '';
  return ALIASES[first] ?? (MODULE_KEYS.has(first) ? first : null);
}
export function pageAccessTarget(href: string, config: NavConfig): string | null {
  const path = pathname(href);
  const instance = resolveNavInstance(config, path);
  if (instance) return `page:${instance.page.id}`;
  return aliasableTargets().some((t) => t.pattern === path) ? `page:${path}` : null;
}
/** A multi-module group offers explicitly named individual data policies. */
export function sectionAccessTargets(
  sectionId: string,
  config: NavConfig,
  hrefs?: readonly string[],
): SectionAccessChoice[] {
  if (sectionId.startsWith('custom:')) {
    const section = config.sections.find((s) => s.id === sectionId.slice(7));
    return section ? [{ target: `section:${section.id}`, label: section.label }] : [];
  }
  const id = sectionId.replace(/^plugins:/, '');
  const module = getModules({ navConfig: EMPTY_NAV_CONFIG }).find((m) => m.id === id);
  const nativeHrefs = hrefs ?? module?.items.map((item) => item.href) ?? [];
  const out = new Map<string, string>();
  for (const href of nativeHrefs) {
    const hit = resolveNavInstance(config, pathname(href));
    const target = moduleTarget(hit?.target ?? href);
    if (!target || out.has(target)) continue;
    const display = target.startsWith('page:')
      ? target.slice(5)
      : target === 'ads'
        ? '/socials'
        : target === 'finance'
          ? '/finances'
          : target === 'projects'
            ? '/workforce'
            : `/${target}`;
    const label = aliasableTargets().find((t) => t.pattern === display)?.title ?? target;
    out.set(target, label);
  }
  return [...out].map(([target, label]) => ({ target, label }));
}
/** Only static nav screens are inferred. Explicit props cover other known contexts. */
export function inferMainPageAccessTarget(href: string, config: NavConfig): string | null {
  const path = pathname(href);
  if (/^\/(?:settings|account)(?:\/|$)/.test(path)) return null;
  const instance = resolveNavInstance(config, path);
  if (instance) {
    if (instance.rest) return null;
    return instance.sectionId ? `section:${instance.sectionId}` : moduleTarget(instance.target);
  }
  for (const section of config.sections)
    if (section.pages.some((p) => p.kind === 'main' && p.target === path))
      return `section:${section.id}`;
  const registered = getModules({ navConfig: EMPTY_NAV_CONFIG }).some((module) =>
    module.items.some((item) => pathname(item.href) === path),
  );
  return registered && aliasableTargets().some((t) => t.pattern === path)
    ? moduleTarget(path)
    : null;
}
