// Pure helpers shared by the CM6 completion source, the draggable chips (C12),
// and the Queries palette (C13). Kept framework-free so the ranking/format logic
// is unit-testable without a browser.

export type Lang = 'javascript' | 'python' | 'bash';

/** Language-appropriate accessor for an env/system/module/database var KEY. */
export function varAccessor(lang: Lang, key: string): string {
	switch (lang) {
		case 'python':
			return `os.environ["${key}"]`;
		case 'bash':
			return `"$${key}"`;
		default:
			return `process.env.${key}`;
	}
}

/**
 * Ready-to-run fetch snippet for a `/api/gateway/query/*` endpoint, using the
 * gateway-injected MINION_HUB_URL / MINION_AGENT_ID / MINION_HUB_TOKEN vars.
 * JS shape is pinned by spec C13; Python (urllib) + Bash (curl) are equivalents.
 */
export function querySnippet(lang: Lang, path: string): string {
	switch (lang) {
		case 'python':
			return [
				'import os, json, urllib.request',
				`url = os.environ["MINION_HUB_URL"] + "${path}?agentId=" + os.environ["MINION_AGENT_ID"]`,
				'req = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["MINION_HUB_TOKEN"]})',
				'with urllib.request.urlopen(req) as r:',
				'    data = json.load(r)',
				'print(json.dumps(data))',
			].join('\n');
		case 'bash':
			return [
				`curl -s "\${MINION_HUB_URL}${path}?agentId=\${MINION_AGENT_ID}" \\`,
				'  -H "Authorization: Bearer ${MINION_HUB_TOKEN}"',
			].join('\n');
		default:
			return [
				`const res = await fetch(\`\${process.env.MINION_HUB_URL}${path}?agentId=\${process.env.MINION_AGENT_ID}\`, {`,
				'  headers: { Authorization: `Bearer ${process.env.MINION_HUB_TOKEN}` },',
				'});',
				'const data = await res.json();',
				'console.log(JSON.stringify(data));',
			].join('\n');
	}
}

/**
 * Commented SQL SELECT reference for a table. There is no raw-SQL execution
 * endpoint — this documents the columns for the fetch path above and feeds the
 * editor's intellisense. Draggable/copyable as a reference block.
 */
export function sqlTemplate(table: string, columns: { name: string }[]): string {
	const cols = columns.length ? columns.map((c) => c.name).join(', ') : '*';
	return [
		`-- reference only: no raw-SQL endpoint. Query via the fetch snippets above.`,
		`SELECT ${cols}`,
		`FROM ${table}`,
		`LIMIT 100;`,
	].join('\n');
}
