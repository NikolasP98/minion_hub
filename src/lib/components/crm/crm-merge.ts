/** Shared types + apply logic for the CRM contact merge / conflict resolver. */

/** A contact shown in the merge picker. */
export type MergeContact = { id: string; name: string; subtitle?: string };

/** One resolvable field: its per-contact values (empty values omitted). The
 *  `key` doubles as the write target — `display_name` → the name column,
 *  `phone` → the phone field, anything else → a `custom_fields` key. */
export type MergeField = {
	key: string;
	label: string;
	values: { contactId: string; value: string }[];
};

/**
 * Merge the losers into the survivor and apply the conflict-resolver choices in
 * ONE server call — the endpoint jsonb-merges the overrides onto the survivor
 * (never a wholesale custom_fields replace, so untouched keys survive). `resolved`
 * maps a MergeField.key → chosen value; `display_name` sets the name, every other
 * key is a `custom_fields` entry.
 */
export async function applyContactMerge(
	survivorId: string,
	loserIds: string[],
	resolved: Record<string, string>,
): Promise<void> {
	const overrides: { displayName?: string; customFields?: Record<string, unknown> } = {};
	const cf: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(resolved)) {
		if (key === 'display_name') overrides.displayName = value;
		else cf[key] = value;
	}
	if (Object.keys(cf).length) overrides.customFields = cf;

	const res = await fetch('/api/crm/cleanup/duplicates', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			survivorId,
			loserIds,
			overrides: Object.keys(overrides).length ? overrides : undefined,
		}),
	});
	if (!res.ok) throw new Error('merge failed');
}
