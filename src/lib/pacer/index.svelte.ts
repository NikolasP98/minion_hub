/**
 * Runes wrapper around `@tanstack/pacer`'s `Debouncer`/`AsyncDebouncer`, so
 * Svelte components get reactive `isPending`/`isExecuting` without every
 * call site re-deriving the `@tanstack/store` subscription boilerplate.
 *
 * Component-scope usage (reactive pending state, needs component/effect context):
 * ```ts
 * const save = createDebouncer(doSave, { wait: 2000 });
 * save.run(); save.isPending; onDestroy(save.flush);
 * ```
 *
 * Module-scope usage (`.svelte.ts` files outside component init, or any
 * caller that doesn't need reactive pending state): instantiate the raw
 * `Debouncer`/`AsyncDebouncer` class directly — both re-exported below.
 * `createKeyedDebouncer` is safe at module scope as-is (no `$effect`).
 *
 * NEVER use `AsyncQueuer` anywhere in this codebase — it leaks memory in
 * long-lived Node processes (tanstack/pacer#198); not wrapped here on purpose.
 */
import { Debouncer, type DebouncerOptions } from '@tanstack/pacer/debouncer';
import { AsyncDebouncer, type AsyncDebouncerOptions } from '@tanstack/pacer/async-debouncer';
import type { AnyFunction, AnyAsyncFunction } from '@tanstack/pacer/types';

export { Debouncer, AsyncDebouncer };
export type { DebouncerOptions, AsyncDebouncerOptions };

/** Mirror a Pacer instance's `@tanstack/store` state into `$state` (component/effect context only). */
function reactive<TState extends { isPending: boolean }>(instance: {
	store: { state: TState; subscribe(cb: (value: TState) => void): { unsubscribe: () => void } };
}) {
	let state = $state(instance.store.state);
	$effect(() => {
		const sub = instance.store.subscribe((value) => (state = value));
		return () => sub.unsubscribe();
	});
	return {
		get state() {
			return state;
		},
	};
}

export function createDebouncer<TFn extends AnyFunction>(fn: TFn, options: DebouncerOptions<TFn>) {
	const d = new Debouncer(fn, options);
	const r = reactive(d);
	return {
		instance: d,
		run: (...args: Parameters<TFn>) => d.maybeExecute(...args),
		cancel: () => d.cancel(),
		flush: () => d.flush(),
		get isPending() {
			return r.state.isPending;
		},
	};
}

export function createAsyncDebouncer<TFn extends AnyAsyncFunction>(
	fn: TFn,
	options: AsyncDebouncerOptions<TFn>,
) {
	const d = new AsyncDebouncer(fn, options);
	const r = reactive(d);
	return {
		instance: d,
		run: (...args: Parameters<TFn>) => d.maybeExecute(...args),
		cancel: () => d.cancel(),
		abort: () => d.abort(),
		flush: () => d.flush(),
		get isPending() {
			return r.state.isPending;
		},
		get isExecuting() {
			return (r.state as unknown as { isExecuting: boolean }).isExecuting;
		},
	};
}

/** One `Debouncer` per key (sections, note ids, session keys). Module-scope safe — no `$effect`. */
export function createKeyedDebouncer<TFn extends AnyFunction>(
	fn: (key: string) => TFn,
	options: DebouncerOptions<TFn>,
) {
	const map = new Map<string, Debouncer<TFn>>();
	function get(key: string): Debouncer<TFn> {
		let d = map.get(key);
		if (!d) {
			d = new Debouncer(fn(key), options);
			map.set(key, d);
		}
		return d;
	}
	return {
		run(key: string, ...args: Parameters<TFn>) {
			get(key).maybeExecute(...args);
		},
		flush(key: string) {
			map.get(key)?.flush();
		},
		cancel(key: string) {
			map.get(key)?.cancel();
		},
		flushAll() {
			for (const d of map.values()) d.flush();
		},
		cancelAll() {
			for (const d of map.values()) d.cancel();
			map.clear();
		},
	};
}
