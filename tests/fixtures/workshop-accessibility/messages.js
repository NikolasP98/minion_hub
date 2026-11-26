export const nav_agents = () => 'Agents';
export const workshop_assignTask = () => 'Assign task';
export const workshop_startConversation = () => 'Start conversation';
export const workshop_describeTask = () => 'Describe task';
export const workshop_whatToDiscuss = () => 'What to discuss';
export const workshop_taskPromptHint = () => 'Ctrl+Enter to send';
export const workshop_send = () => 'Send';
export const workshop_start = () => 'Start';
export const common_cancel = () => 'Cancel';
export const common_close = () => 'Close';
export const workshop_kbElements = () => 'Elements';
export const workshop_open = () => 'Open';
export const workshop_removeFromCanvas = () => 'Remove from canvas';
export const workshop_kbMove = () => 'Move';
export const workshop_kbLinkTo = (/** @type {{ name: string }} */ { name }) => `Link to ${name}…`;
export const workshop_kbMoreActions = (/** @type {{ name: string }} */ { name }) =>
  `More actions: ${name}`;
export const workshop_kbMoving = (/** @type {{ name: string }} */ { name }) =>
  `Moving ${name}. Arrow keys move it, Enter drops it, Escape puts it back.`;
export const workshop_kbMovingHint = () => 'Moving: arrows, Enter to drop, Esc to cancel';
export const workshop_kbMoved = (/** @type {{ name: string }} */ { name }) => `${name} moved`;
export const workshop_kbMoveCancelled = (/** @type {{ name: string }} */ { name }) =>
  `${name} is back where it was`;
export const workshop_kbRemoved = (/** @type {{ name: string }} */ { name }) =>
  `${name} removed from the canvas`;
