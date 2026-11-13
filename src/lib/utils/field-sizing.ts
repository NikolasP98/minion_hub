/** True when the browser grows textareas natively (`field-sizing: content`); the scripted resize then stays off. */
export const nativeFieldSizing =
  typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
