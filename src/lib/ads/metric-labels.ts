import * as m from '$lib/paraglide/messages';

// Raw metric keys come straight off the Meta Graph API (fixed vocabulary —
// see meta-sync/graph-read services); map the ones we know to human labels
// and fall back to a light humanization for anything unforeseen. Shared by
// the posts table and the post detail page's stats grid — one metric always
// reads the same label everywhere.
// ponytail: static map, not a translation lookup service — add a key here if a new metric shows up.
export const METRIC_LABELS: Record<string, () => string> = {
	reactions_total: m.ads_col_reactions,
	reactions: m.ads_col_reactions,
	post_reactions_by_type_total: m.ads_col_reactions,
	comments_total: m.ads_col_comments,
	comments: m.ads_col_comments,
	shares_total: m.ads_col_shares,
	shares: m.ads_col_shares,
	saved: m.ads_col_saved,
	likes: m.ads_col_likes,
	views: m.ads_col_views,
	plays: m.ads_col_plays,
	reach: m.ads_col_reach,
	post_impressions: m.ads_col_impressions,
	post_impressions_unique: m.ads_col_impressions_unique,
	post_clicks: m.ads_col_clicks,
};

export function metricLabel(key: string): string {
	const known = METRIC_LABELS[key];
	if (known) return known();
	return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
