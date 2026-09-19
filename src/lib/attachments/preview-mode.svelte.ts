/**
 * How attachment primitives render, shared by every list on every page and
 * remembered per browser (a per-viewer convenience, so localStorage):
 *   off   — plain rows, type icon only
 *   hover — rows; images reveal a floating preview on hover/focus
 *   card  — thumbnail cards in a grid
 */
export type AttachmentPreviewMode = 'off' | 'hover' | 'card';

const KEY = 'hub-attachments-preview';
const MODES: AttachmentPreviewMode[] = ['off', 'hover', 'card'];

function read(): AttachmentPreviewMode {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v as AttachmentPreviewMode) ? (v as AttachmentPreviewMode) : 'hover';
  } catch {
    return 'hover';
  }
}

export const attachmentPreview = $state<{ mode: AttachmentPreviewMode }>({
  mode: typeof localStorage === 'undefined' ? 'hover' : read(),
});

export function setAttachmentPreview(mode: string) {
  const next = MODES.includes(mode as AttachmentPreviewMode)
    ? (mode as AttachmentPreviewMode)
    : 'hover';
  attachmentPreview.mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode / blocked storage — the choice just doesn't persist */
  }
}
