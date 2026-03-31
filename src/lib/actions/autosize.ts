import { TextareaAutosize } from 'runed';

/**
 * Svelte action that auto-sizes a textarea vertically to fit its content.
 * Uses runed's TextareaAutosize with a hidden clone for accurate measurement.
 *
 * Usage: <textarea use:autosize={value} />
 *
 * The parameter should be the reactive text value so the action
 * re-measures whenever content changes (including programmatic updates).
 */
export function autosize(node: HTMLTextAreaElement, value: string) {
	// Remove fixed rows so height is purely driven by content
	node.style.overflow = 'hidden';
	node.style.resize = 'none';

	let currentValue = value;

	const ta = new TextareaAutosize({
		element: node,
		input: () => currentValue,
		styleProp: 'height',
	});

	return {
		update(newValue: string) {
			currentValue = newValue;
			ta.triggerResize();
		},
		destroy() {
			// TextareaAutosize cleans up via GC (no explicit destroy)
			node.style.overflow = '';
			node.style.resize = '';
		},
	};
}
