export type WindowRect = { x: number; y: number; width: number; height: number };

const WINDOW_CONTROL_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [role='tab'], [data-window-no-drag]";

/**
 * Title-bar controls must keep ownership of their pointer sequence. If the
 * drag surface captures pointer-down from a nested button, Chromium retargets
 * the matching pointer-up and the button's click never completes.
 */
export function isWindowControlTarget(target: EventTarget | null): boolean {
  const candidate = target as { closest?: (selector: string) => Element | null } | null;
  return (
    typeof candidate?.closest === 'function' && candidate.closest(WINDOW_CONTROL_SELECTOR) != null
  );
}

export function clampWindowRect(
  rect: WindowRect,
  viewport: { width: number; height: number },
  minimum: { width: number; height: number },
): WindowRect {
  const width = Math.min(Math.max(rect.width, minimum.width), viewport.width);
  const height = Math.min(Math.max(rect.height, minimum.height), viewport.height);
  return {
    x: Math.min(Math.max(rect.x, 0), Math.max(0, viewport.width - 80)),
    y: Math.min(Math.max(rect.y, 0), Math.max(0, viewport.height - 44)),
    width,
    height,
  };
}

export function moveWindowBy(rect: WindowRect, dx: number, dy: number): WindowRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

export function resizeWindowBy(rect: WindowRect, dw: number, dh: number): WindowRect {
  return { ...rect, width: rect.width + dw, height: rect.height + dh };
}
