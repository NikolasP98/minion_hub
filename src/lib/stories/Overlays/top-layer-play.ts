import { expect, userEvent, waitFor, within } from 'storybook/test';
import './top-layer-play.css';

/** The Zag positioner (the `popover="manual"` element) of the panel whose content has `id`. */
export async function positionerOf(getId: () => string | null | undefined): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    const id = getId();
    el = id
      ? (document.getElementById(id)?.closest<HTMLElement>('[data-part="positioner"]') ?? null)
      : null;
    expect(el).not.toBeNull();
  });
  return el!;
}

/**
 * The panel is in the top layer, sits next to its trigger (placement is
 * unchanged), stays inside the viewport and paints on top: the topmost element
 * at a point of the panel is the panel itself. With `clip`, the panel must
 * extend past that box (an `overflow` container or a dialog) and the hit test
 * runs on the part OUTSIDE it, where a clipped or covered panel would lose.
 */
export async function expectPanelOnTop(
  panel: HTMLElement,
  { trigger, clip }: { trigger: Element; clip?: Element },
) {
  await waitFor(() => expect(panel.matches(':popover-open')).toBe(true));
  // Zag positions in a `raf`; wait until its coordinates landed next to the trigger.
  await waitFor(() => {
    const r = panel.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    expect(r.width).toBeGreaterThan(0);
    expect(Math.max(r.top - t.bottom, t.top - r.bottom, 0)).toBeLessThanOrEqual(16);
    expect(Math.max(r.left - t.right, t.left - r.right, 0)).toBeLessThanOrEqual(16);
  });

  const r = panel.getBoundingClientRect();
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.right).toBeLessThanOrEqual(window.innerWidth);
  expect(r.bottom).toBeLessThanOrEqual(window.innerHeight);

  let x = (r.left + r.right) / 2;
  let y = (r.top + r.bottom) / 2;
  if (clip) {
    const b = clip.getBoundingClientRect();
    expect(r.width * r.height).toBeGreaterThan(0);
    if (r.bottom > b.bottom + 4) y = (Math.max(r.top, b.bottom) + r.bottom) / 2;
    else if (r.right > b.right + 4) x = (Math.max(r.left, b.right) + r.right) / 2;
    else if (r.top < b.top - 4) y = (r.top + Math.min(r.bottom, b.top)) / 2;
    else
      throw new Error(`panel does not extend past the clipping box: ${JSON.stringify({ r, b })}`);
  }

  // A plain Tooltip is `pointer-events: none`, which hit testing skips; lift it
  // for the probe only (painting order is what is under test).
  const prev = panel.style.pointerEvents;
  panel.style.pointerEvents = 'auto';
  panel
    .querySelectorAll<HTMLElement>('*')
    .forEach((el) => el.style.setProperty('pointer-events', 'auto'));
  try {
    const hit = document.elementFromPoint(x, y);
    expect(hit != null && panel.contains(hit)).toBe(true);
  } finally {
    panel.style.pointerEvents = prev;
    panel
      .querySelectorAll<HTMLElement>('*')
      .forEach((el) => el.style.removeProperty('pointer-events'));
  }
}

/** A native `<dialog>` opened with `showModal()` on mount, as hub drawers are. */
export function showModal(dialog: HTMLDialogElement) {
  dialog.showModal();
  return () => dialog.close();
}

// ── Play functions for the InsideModalDialog / InsideOverflowHidden stories ──
// Each story marks its clipping box (the dialog, or the overflow box) with
// `data-testid="clip"`.

type Ctx = { canvasElement: HTMLElement };

const triggerButton = (ctx: Ctx, text: string) => {
  const button = within(ctx.canvasElement).getByText(text).closest('button');
  if (!button) throw new Error(`no trigger button around "${text}"`);
  return button;
};
const clipOf = (ctx: Ctx) => within(ctx.canvasElement).getByTestId('clip');

/** Click the Popover/Dropdown trigger labelled `text`; its panel must be on top of the clip box. */
async function openOnTop(ctx: Ctx, text: string) {
  const trigger = triggerButton(ctx, text);
  await userEvent.click(trigger);
  const panel = await positionerOf(() => trigger.getAttribute('aria-controls'));
  await expectPanelOnTop(panel, { trigger, clip: clipOf(ctx) });
  return { trigger, panel };
}

/** Escape stays Zag's: it closes, returns focus to the trigger, and the panel leaves the top layer. */
async function escapeCloses(trigger: HTMLElement, panel: HTMLElement) {
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(panel.matches(':popover-open')).toBe(false);
}

export const popoverOnTop = async (ctx: Ctx) => {
  await openOnTop(ctx, 'Filters');
};

export const popoverInDialog = async (ctx: Ctx) => {
  const { trigger, panel } = await openOnTop(ctx, 'Filters');
  await escapeCloses(trigger, panel);
};

export const dropdownOnTop = async (ctx: Ctx) => {
  await openOnTop(ctx, 'Actions');
};

export const dropdownInDialog = async (ctx: Ctx) => {
  const { trigger, panel } = await openOnTop(ctx, 'Actions');
  // Keyboard stays Zag's: focus is inside the menu and arrows move the highlight.
  await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
  await userEvent.keyboard('{ArrowDown}');
  await waitFor(() => expect(panel.querySelector('[data-highlighted]')).not.toBeNull());
  await escapeCloses(trigger, panel);
};

/**
 * FilterChip's shape: a menu opened from inside a Popover panel, inside a
 * modal drawer. Shown later, the menu paints above its host panel with no
 * z-index tier, and Escape dismisses only the menu.
 */
export const dropdownNestedInDialog = async (ctx: Ctx) => {
  const hostTrigger = triggerButton(ctx, 'Filter');
  await userEvent.click(hostTrigger);
  const host = await positionerOf(() => hostTrigger.getAttribute('aria-controls'));
  await expectPanelOnTop(host, { trigger: hostTrigger });

  const trigger = triggerButton(ctx, 'More');
  await userEvent.click(trigger);
  const menu = await positionerOf(() => trigger.getAttribute('aria-controls'));
  await expectPanelOnTop(menu, { trigger });
  expect(host.matches(':popover-open')).toBe(true);

  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(menu.matches(':popover-open')).toBe(false));
  expect(host.matches(':popover-open')).toBe(true);
};

/** Hover the tooltip trigger: the label is on top of the clip box and no focus moved. */
export const tooltipOnTop = async (ctx: Ctx) => {
  // The Zag trigger props live on Tooltip's wrapper span, around the test id.
  const trigger = within(ctx.canvasElement).getByTestId('tip-trigger').parentElement!;
  const focused = document.activeElement;
  await userEvent.hover(trigger);
  const panel = await positionerOf(() => trigger.getAttribute('aria-describedby'));
  await expectPanelOnTop(panel, { trigger, clip: clipOf(ctx) });
  expect(document.activeElement).toBe(focused);
};

/** Open the combobox list on top of the clip box, then type: it filters, stays open, input keeps focus. */
export const comboboxOnTop = async (ctx: Ctx) => {
  const input = within(ctx.canvasElement).getByRole('combobox');
  await userEvent.click(input);
  const panel = await positionerOf(() => input.getAttribute('aria-controls'));
  await expectPanelOnTop(panel, { trigger: input, clip: clipOf(ctx) });
  await userEvent.type(input, 'cu');
  await waitFor(() => expect(panel.querySelectorAll('[role="option"]').length).toBe(1));
  expect(panel.matches(':popover-open')).toBe(true);
  expect(document.activeElement).toBe(input);
};
