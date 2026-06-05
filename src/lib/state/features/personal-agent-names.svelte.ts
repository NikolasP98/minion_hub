import { browser } from '$app/environment';

/**
 * Reactive map of personal-agent id → owner username, sourced from
 * `GET /api/personal-agents?scope=org` (the `user ⋈ personalAgents` join,
 * label = name ?? email).
 *
 * Personal agents have machine ids (`personal-<user hash>`) and no curated
 * name, so without this they render as raw hashes. `agentDisplayName` consults
 * this map so every surface (sidebar, header, workshop) labels a personal agent
 * by its owner's username. Loaded once per session via `loadPersonalAgentNames`.
 */
const names = $state<Record<string, string>>({});
let loaded = false;

export async function loadPersonalAgentNames(force = false): Promise<void> {
	if (!browser) return;
	if (loaded && !force) return;
	loaded = true;
	try {
		const res = await fetch('/api/personal-agents?scope=org');
		if (!res.ok) return;
		const body = (await res.json()) as {
			personalAgents?: Array<{ agentId: string; userName: string }>;
		};
		// Replace contents in place so existing reactive reads update. Keys are
		// lowercased: the gateway lowercases personal-agent ids, but the hub DB
		// stores the original mixed-case user id — match case-insensitively.
		for (const k of Object.keys(names)) delete names[k];
		for (const p of body.personalAgents ?? []) {
			if (p.agentId && p.userName) names[p.agentId.toLowerCase()] = p.userName;
		}
	} catch {
		// non-critical — falls back to the generic "Personal · …" label
		loaded = false;
	}
}

/** Owner username for a personal-agent id, or undefined if unknown/not loaded. */
export function personalAgentName(agentId: string): string | undefined {
	return names[agentId.toLowerCase()];
}
