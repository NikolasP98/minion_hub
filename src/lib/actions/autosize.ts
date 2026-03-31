import { TextareaAutosize } from 'runed';

/**
 * Svelte action that auto-sizes a textarea vertically to fit its content.
 * Uses runed's TextareaAutosize with a hidden clone for accurate measurement.
 *
 * Usage:
 *   <textarea use:autosize={value} />                — grows unbounded
 *   <textarea use:autosize={{ value, max: 200 }} />  — grows up to 200px, then scrolls
 *
 * The textarea auto-grows as content increases. When a max is set,
 * overflow switches to scroll once the limit is hit.
 */
export function autosize(
	node: HTMLTextAreaElement,
	param: string | { value: string; max?: number },
) {
	let currentValue = typeof param === 'string' ? param : param.value;
	const maxHeight = typeof param === 'object' ? param.max : undefined;

	const ta = new TextareaAutosize({
		element: node,
		input: () => currentValue,
		styleProp: 'minHeight',
		maxHeight,
	});

	return {
		update(newParam: string | { value: string; max?: number }) {
			currentValue = typeof newParam === 'string' ? newParam : newParam.value;
			ta.triggerResize();
		},
		destroy() {
			node.style.minHeight = '';
		},
	};
}
