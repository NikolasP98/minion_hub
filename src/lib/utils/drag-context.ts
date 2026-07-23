/**
 * Drag-and-drop context payloads for the `/my-agent` page.
 *
 * Events, emails, notes, and todos can be dragged into the chat input to add
 * them as context for the agent. The drag source serialises a `DragContext`
 * onto the DataTransfer under a private MIME type; the ChatInput drop target
 * reads it back and renders a removable chip whose `text` is folded into the
 * prompt on send.
 *
 * We also write `text/plain` so a drop outside the app (or into a plain text
 * field) still yields something useful.
 */

export const DRAG_MIME = 'application/x-minion-context';

export type DragContextKind = 'event' | 'email' | 'note' | 'todo' | 'chat';

export interface DragContext {
  kind: DragContextKind;
  /** Short label for the chip (truncated in the UI). */
  label: string;
  /** Full context block folded into the prompt when the message is sent. */
  text: string;
}

const KIND_ICON: Record<DragContextKind, string> = {
  event: '📅',
  email: '✉️',
  note: '🗒️',
  todo: '☑️',
  chat: '💬',
};

export function dragContextIcon(kind: DragContextKind): string {
  return KIND_ICON[kind] ?? '📎';
}

/**
 * Compact drag preview: a tangible icon+title pill that follows the cursor.
 *
 * setDragImage is NOT used for the visible pill — browsers force their own
 * ~50% alpha onto native drag images and control the offset. Instead the
 * native ghost is suppressed with a 1px transparent canvas and a real
 * fully-opaque DOM pill is moved with the cursor via document `dragover`
 * (the reliable coordinate source during a drag; the source's `drag` event
 * reports 0,0 on some platforms). `pointer-events:none` keeps the pill from
 * stealing dragover from real drop targets.
 */
let ghostCanvas: HTMLCanvasElement | null = null;
function transparentGhost(): HTMLCanvasElement {
  if (!ghostCanvas) {
    ghostCanvas = document.createElement('canvas');
    ghostCanvas.width = 4;
    ghostCanvas.height = 4;
    // A fully-transparent bitmap makes some platforms (Linux/GTK Chromium)
    // substitute their default "document" drag badge. Paint one near-invisible
    // pixel so the bitmap is non-empty and gets used as-is.
    const g = ghostCanvas.getContext('2d');
    if (g) {
      g.fillStyle = 'rgba(0,0,0,0.01)';
      g.fillRect(0, 0, 4, 4);
    }
    ghostCanvas.style.cssText = 'position:absolute;top:-10px;left:-10px;pointer-events:none';
    document.body.appendChild(ghostCanvas);
  }
  return ghostCanvas;
}

function buildDragPill(ctx: DragContext): HTMLElement {
  const pill = document.createElement('div');
  pill.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'transform:translate(-1000px,-1000px)',
    'z-index:var(--layer-toast, 9999)',
    'display:flex',
    'align-items:center',
    'gap:6px',
    'max-width:240px',
    'padding:5px 12px 5px 9px',
    'border-radius:var(--radius-full, 999px)',
    'background:var(--color-bg2)',
    'border:1px solid var(--color-border)',
    'box-shadow:var(--shadow-overlay)',
    'font-family:inherit',
    'font-size:var(--font-size-caption, 12px)',
    'font-weight:600',
    'color:var(--color-foreground)',
    'pointer-events:none',
    'will-change:transform',
  ].join(';');
  const icon = document.createElement('span');
  icon.textContent = dragContextIcon(ctx.kind);
  icon.style.cssText = 'flex-shrink:0;line-height:1';
  const label = document.createElement('span');
  label.textContent = ctx.label;
  label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  pill.append(icon, label);
  document.body.appendChild(pill);
  return pill;
}

function startDragPreview(e: DragEvent, ctx: DragContext): void {
  const pill = buildDragPill(ctx);
  const move = (ev: DragEvent) => {
    // Tucked just under the pointer tip — close, but not covering it.
    pill.style.transform = `translate(${ev.clientX + 6}px, ${ev.clientY + 10}px)`;
  };
  const end = () => {
    document.removeEventListener('dragover', move);
    document.removeEventListener('dragend', end);
    document.removeEventListener('drop', end);
    pill.remove();
  };
  move(e);
  document.addEventListener('dragover', move);
  document.addEventListener('dragend', end);
  document.addEventListener('drop', end);
}

/** Attach a context payload to a dragstart event. */
export function setDragContext(e: DragEvent, ctx: DragContext): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ctx));
  e.dataTransfer.setData('text/plain', ctx.text);
  e.dataTransfer.effectAllowed = 'copy';
  if (typeof document !== 'undefined' && typeof e.dataTransfer.setDragImage === 'function') {
    e.dataTransfer.setDragImage(transparentGhost(), 0, 0);
    startDragPreview(e, ctx);
  }
}

/** Read a context payload from a drop event, or null if it isn't one of ours. */
export function readDragContext(e: DragEvent): DragContext | null {
  const raw = e.dataTransfer?.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragContext;
    if (parsed && typeof parsed.text === 'string' && typeof parsed.label === 'string') {
      return parsed;
    }
  } catch {
    /* not our payload */
  }
  return null;
}

/** True when a drag event carries one of our context payloads. */
export function hasDragContext(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DRAG_MIME);
}
