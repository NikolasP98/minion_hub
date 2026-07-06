import {
	Virtualizer,
	elementScroll,
	observeElementOffset,
	observeElementRect,
	observeWindowOffset,
	observeWindowRect,
	windowScroll,
} from '@tanstack/virtual-core';
import type { PartialKeys, VirtualizerOptions } from '@tanstack/virtual-core';

// ponytail: hand-rolled runes wrapper around @tanstack/virtual-core (headless).
// @tanstack/svelte-virtual is a Svelte-4 store shim with open Svelte-5 bugs
// (#866/#932/#969) — see specs/2026-07-05-hub-tanstack-virtual.md §0. Do not swap in.

type Opts<S extends Element | Window, I extends Element> = PartialKeys<
	VirtualizerOptions<S, I>,
	'observeElementRect' | 'observeElementOffset' | 'scrollToFn'
>;

export function createVirtualizer<S extends Element, I extends Element>(options: Opts<S, I>) {
	return wrap(
		new Virtualizer<S, I>({
			observeElementRect,
			observeElementOffset,
			scrollToFn: elementScroll,
			...options,
		}),
		options,
	);
}

type WindowOpts<I extends Element> = PartialKeys<
	VirtualizerOptions<Window, I>,
	'observeElementRect' | 'observeElementOffset' | 'scrollToFn' | 'getScrollElement' | 'initialOffset'
>;

export function createWindowVirtualizer<I extends Element>(options: WindowOpts<I>) {
	return wrap(
		new Virtualizer<Window, I>({
			getScrollElement: () => (typeof window !== 'undefined' ? window : null),
			observeElementRect: observeWindowRect,
			observeElementOffset: observeWindowOffset,
			scrollToFn: windowScroll,
			initialOffset: () => (typeof window !== 'undefined' ? window.scrollY : 0),
			...options,
		} as VirtualizerOptions<Window, I>),
		options,
	);
}

function wrap<S extends Element | Window, I extends Element>(
	instance: Virtualizer<S, I>,
	options: { onChange?: VirtualizerOptions<S, I>['onChange'] },
) {
	let virtualItems = $state.raw(instance.getVirtualItems());
	let totalSize = $state(instance.getTotalSize());

	instance.setOptions({
		...instance.options,
		onChange: (inst, sync) => {
			virtualItems = inst.getVirtualItems();
			totalSize = inst.getTotalSize();
			options.onChange?.(inst, sync);
		},
	});

	$effect(() => {
		const cleanup = instance._didMount();
		instance._willUpdate();
		return cleanup;
	});

	return new Proxy(instance, {
		get(target, prop) {
			if (prop === 'getVirtualItems') return () => virtualItems;
			if (prop === 'getTotalSize') return () => totalSize;
			return Reflect.get(target, prop);
		},
	}) as Virtualizer<S, I>;
}
