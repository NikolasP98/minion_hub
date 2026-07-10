import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { varAccessor, type Lang } from './tool-editor-snippets';

export type CompletionData = {
	/** User-defined env var keys. */
	envKeys: string[];
	/** MINION_* system var keys (read-only, gateway-injected). */
	systemKeys: string[];
	/** MINION_HUB_* module var keys. */
	moduleKeys: string[];
	/** MINION_DB_* database var keys. */
	databaseKeys: string[];
	/** `/api/gateway/query|actions/*` endpoint paths. */
	modulePaths: string[];
	/** DB tables + columns from the schema-catalog (C11). */
	tables: { name: string; columns: { name: string; type: string }[] }[];
};

const SQL_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'LIMIT', 'AND', 'OR', 'INSERT INTO', 'UPDATE', 'SET', 'VALUES'];

/**
 * One completion source fed entirely from data the page already fetched. Offers:
 *  - env / system / module / database var keys → inserted as a language accessor
 *  - module endpoint paths
 *  - SQL tables + columns when the cursor sits in a SQL-ish string
 * Each option carries a short type tag (var / endpoint / table / column / keyword).
 * The SQL heuristic is intentionally cheap: it keys off SQL words in the current
 * line (usually a string/template literal) rather than parsing the host language.
 */
export function buildCompletionSource(data: CompletionData, lang: Lang): CompletionSource {
	const tablesByName = new Map(data.tables.map((t) => [t.name.toLowerCase(), t]));

	const varOptions: Completion[] = [];
	for (const k of data.envKeys) varOptions.push({ label: k, type: 'variable', detail: 'var', apply: varAccessor(lang, k) });
	for (const k of data.systemKeys) varOptions.push({ label: k, type: 'variable', detail: 'var', apply: varAccessor(lang, k) });
	for (const k of data.moduleKeys) varOptions.push({ label: k, type: 'variable', detail: 'var', apply: varAccessor(lang, k) });
	for (const k of data.databaseKeys) varOptions.push({ label: k, type: 'variable', detail: 'var', apply: varAccessor(lang, k) });
	for (const p of data.modulePaths) varOptions.push({ label: p, type: 'text', detail: 'endpoint', apply: p });

	const tableOptions: Completion[] = data.tables.map((t) => ({ label: t.name, type: 'type', detail: 'table' }));

	return (ctx: CompletionContext): CompletionResult | null => {
		// `table.` / `alias.` → offer that table's columns.
		const dotted = ctx.matchBefore(/(\w+)\.(\w*)$/);
		if (dotted) {
			const parts = /(\w+)\.(\w*)$/.exec(dotted.text);
			const tbl = parts && tablesByName.get(parts[1].toLowerCase());
			if (parts && tbl) {
				return {
					from: dotted.from + parts[1].length + 1,
					options: tbl.columns.map((c) => ({ label: c.name, type: 'property', detail: 'column', info: c.type })),
				};
			}
			return null;
		}

		const word = ctx.matchBefore(/[\w$]+/);
		if (!word || (word.from === word.to && !ctx.explicit)) return null;

		const line = ctx.state.doc.lineAt(ctx.pos);
		const lineText = line.text;
		const beforeCursor = lineText.slice(0, ctx.pos - line.from);
		const isSql = /\b(select|from|where|join|into)\b/i.test(lineText);

		const options: Completion[] = [];

		if (isSql && data.tables.length) {
			if (/\b(from|join|into|update)\s+\w*$/i.test(beforeCursor)) {
				options.push(...tableOptions);
			} else {
				// Columns of any table named on this line, then all tables + keywords.
				for (const t of data.tables) {
					if (lineText.toLowerCase().includes(t.name.toLowerCase())) {
						for (const c of t.columns) options.push({ label: c.name, type: 'property', detail: 'column', info: c.type });
					}
				}
				options.push(...tableOptions);
				for (const kw of SQL_KEYWORDS) options.push({ label: kw, type: 'keyword', detail: 'keyword' });
			}
		}

		options.push(...varOptions);
		if (!options.length) return null;
		return { from: word.from, options };
	};
}
