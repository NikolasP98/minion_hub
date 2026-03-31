import { TextareaAutosize } from 'runed';

/**
 * Svelte action that auto-sizes a textarea vertically to fit its content.
 * Uses runed's TextareaAutosize with a hidden clone for accurate measurement.
 *
 * Usage: <textarea use:autosize={value} />
 *
 * The textarea auto-grows as content increases and can still be manually
 * resized larger by the user (resize: vertical is preserved).
 */
export function autosize(node: HTMLTextAreaElement, value: string) {
	let currentValue = value;

	const ta = new TextareaAutosize({
		element: node,
		input: () => currentValue,
		styleProp: 'minHeight',
	});

	return {
		update(newValue: string) {
			currentValue = newValue;
			ta.triggerResize();
		},
		destroy() {
			node.style.minHeight = '';
		},
	};
}
