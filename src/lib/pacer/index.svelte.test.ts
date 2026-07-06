/**
 * Smoke tests for the pacer runes wrapper. `createDebouncer`/`createAsyncDebouncer`
 * use `$effect` internally (store subscription), so exercise them inside an
 * `$effect.root` scope, same pattern as `async.svelte.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncer, createAsyncDebouncer, createKeyedDebouncer } from './index.svelte';

describe('createDebouncer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('fires once after the wait, latest call wins, flush/cancel work', () => {
		const cleanup = $effect.root(() => {
			const save = vi.fn();
			const d = createDebouncer(save, { wait: 500 });

			d.run('a');
			vi.advanceTimersByTime(200);
			d.run('b'); // resets the timer, supersedes 'a'
			vi.advanceTimersByTime(499);
			expect(save).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(save).toHaveBeenCalledTimes(1);
			expect(save).toHaveBeenCalledWith('b');

			d.run('c');
			d.flush();
			expect(save).toHaveBeenCalledTimes(2);
			expect(save).toHaveBeenLastCalledWith('c');

			d.run('d');
			d.cancel();
			vi.advanceTimersByTime(1000);
			expect(save).toHaveBeenCalledTimes(2); // cancelled, no third call
		});
		cleanup();
	});
});

describe('createAsyncDebouncer', () => {
	it('collapses a burst into a single execution with the latest args', async () => {
		let cleanup: () => void;
		let result: Promise<void>;
		cleanup = $effect.root(() => {
			result = (async () => {
				const fn = vi.fn(async (term: string) => term);
				const d = createAsyncDebouncer(fn, { wait: 10 });
				d.run('a');
				d.run('b');
				await d.run('c');
				expect(fn).toHaveBeenCalledTimes(1);
				expect(fn).toHaveBeenCalledWith('c');
			})();
		});
		await result!;
		cleanup();
	});
});

describe('createKeyedDebouncer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('debounces independently per key', () => {
		const calls: string[] = [];
		const kd = createKeyedDebouncer<() => void>((key) => () => calls.push(key), { wait: 100 });

		kd.run('note-1');
		kd.run('note-2');
		vi.advanceTimersByTime(100);
		expect(calls.sort()).toEqual(['note-1', 'note-2']);

		kd.run('note-1');
		kd.flushAll();
		expect(calls).toEqual(['note-1', 'note-2', 'note-1']);
	});
});
