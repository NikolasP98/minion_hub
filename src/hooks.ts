import type { Reroute } from '@sveltejs/kit';
import { i18n } from '$lib/i18n';
import { resolveAliasPath } from '$lib/nav/alias-reroute';

const localeReroute = i18n.reroute();

// Spec 037: `/<section>/<slug>~<id>/…` renders the target's route subtree.
export const reroute: Reroute = async ({ url, fetch }) => {
  const stripped = (await localeReroute({ url, fetch })) ?? url.pathname;
  return (await resolveAliasPath(stripped, fetch)) ?? stripped;
};
