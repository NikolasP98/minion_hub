/**
 * Theme-aware chart color resolver.
 *
 * ECharts (and inline `style="background:…"` bindings) need *concrete* color
 * strings — they can't consume `var(--token)` references. But the hub recolors
 * its CSS custom properties at runtime across 8 themes via `applyTheme()`. So
 * instead of hardcoding hex literals in chart configs (which freeze to one
 * theme), resolve the active theme's token value at the moment the option is
 * built.
 *
 * `cssVar()` reads the computed value off `document.documentElement` so it
 * reflects whatever theme is currently applied. On the server (SSR) and under
 * vitest there is no `document`, so every accessor falls back to the canonical
 * default hex baked into `src/app.css` `@theme`.
 *
 * NOTE on live theme switching: these are pure functions read at option-build
 * time. A chart built once at mount captures the theme that was active then.
 * If a theme switches while a chart is mounted, the chart keeps its original
 * colors until its option is rebuilt (e.g. on the next data refresh). Most
 * panels here poll/refresh on a 60s interval, so they self-heal; a full live
 * recolor wiring (re-reading on theme change) is out of scope — this refactor
 * only removes the hardcoding and sources colors from tokens.
 */

/** Canonical defaults — must mirror `src/app.css` `@theme` token values. */
const DEFAULTS = {
	accent: '#3b82f6',
	info: '#3b82f6',
	success: '#22c55e',
	warning: '#f59e0b',
	destructive: '#ef4444',
	purple: '#a855f7',
	pink: '#ec4899',
	cyan: '#06b6d4',
	emerald: '#10b981',
	neutral: '#64748b',
	muted: '#a1a1aa',
	mutedForeground: '#71717a',
	foreground: '#fafafa',
	border: 'rgba(255, 255, 255, 0.08)',
} as const;

/**
 * Read a CSS custom property's computed value off the document root, resolved
 * to a concrete string. Returns `fallback` when there is no `document` (SSR /
 * tests) or the property is unset/empty.
 */
export function cssVar(name: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return v || fallback;
}

export interface ChartColors {
	accent: string;
	info: string;
	success: string;
	warning: string;
	destructive: string;
	purple: string;
	pink: string;
	cyan: string;
	emerald: string;
	neutral: string;
	muted: string;
	mutedForeground: string;
	foreground: string;
	border: string;
}

/**
 * Semantic palette resolved to concrete hex/rgb strings for the active theme.
 * Call this when building an ECharts option (or an inline style color) so the
 * values track whatever theme is currently applied.
 */
export function chartColors(): ChartColors {
	return {
		accent: cssVar('--color-accent', DEFAULTS.accent),
		info: cssVar('--color-info', DEFAULTS.info),
		success: cssVar('--color-success', DEFAULTS.success),
		warning: cssVar('--color-warning', DEFAULTS.warning),
		destructive: cssVar('--color-destructive', DEFAULTS.destructive),
		purple: cssVar('--color-purple', DEFAULTS.purple),
		pink: cssVar('--color-pink', DEFAULTS.pink),
		cyan: cssVar('--color-cyan', DEFAULTS.cyan),
		emerald: cssVar('--color-emerald', DEFAULTS.emerald),
		neutral: cssVar('--color-neutral', DEFAULTS.neutral),
		muted: cssVar('--color-muted', DEFAULTS.muted),
		mutedForeground: cssVar('--color-muted-foreground', DEFAULTS.mutedForeground),
		foreground: cssVar('--color-foreground', DEFAULTS.foreground),
		border: cssVar('--color-border', DEFAULTS.border),
	};
}

/**
 * Health / credential / skill status → resolved theme color.
 *
 * Mirrors the status key sets the reliability panels use:
 *  - credential health: ok | expiring | expired | static | missing
 *  - skill stats:        ok | error | auth_error | timeout
 * Unknown keys fall back to the neutral token.
 */
export type StatusKey =
	| 'ok'
	| 'expiring'
	| 'expired'
	| 'static'
	| 'missing'
	| 'error'
	| 'auth_error'
	| 'timeout'
	| (string & {});

export function statusColor(status: StatusKey): string {
	const c = chartColors();
	switch (status) {
		case 'ok':
			return c.success;
		case 'expiring':
		case 'auth_error':
			return c.warning;
		case 'expired':
		case 'error':
			return c.destructive;
		case 'static':
			return c.neutral;
		case 'missing':
		case 'timeout':
			return c.purple;
		default:
			return c.neutral;
	}
}
