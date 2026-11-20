/**
 * assertPattern — one call proves a widget follows its WAI-ARIA Authoring Practices
 * (APG) contract: roles, names, states, exactly one tab stop, key behavior and focus
 * rules (spec 137, FR-005..FR-007). Every problem is collected and reported together.
 *
 * Pure DOM, no test-framework import, so it runs in happy-dom mounted tests and in
 * real-browser story `play` functions alike:
 *
 *   await assertPattern(container, 'listbox');
 *   await assertPattern(document.body, 'dialog', { opener: button });
 *
 * Keys are synthetic `keydown`/`keyup` events on the focused element. Synthetic events
 * do not trigger native default actions (Tab moving focus, a native `<dialog>` closing
 * on Escape), so pass `press` with real key input (e.g. `userEvent.keyboard`) for
 * widgets that rely on them. Do not run it under fake timers: it waits a frame after
 * every key so reactive frameworks can update the DOM.
 *
 * Usage docs with one example per pattern: `docs/a11y.md`.
 */

export type Pattern = 'listbox' | 'menu' | 'tabs' | 'dialog' | 'alertdialog' | 'combobox' | 'grid';

export interface PatternProblem {
  /** Stable rule id (see PATTERN_RULES); pass it in `skip` to waive it explicitly. */
  rule: string;
  /** The APG expectation that was broken. */
  expected: string;
  /** The offending element, described as `tag#id[role]"name"`. */
  element: string;
}

export interface PatternOptions {
  /** Arrow axis for listbox, menu and tabs. Default: vertical (tabs: horizontal). */
  orientation?: 'vertical' | 'horizontal';
  /** The control that opened a dialog or popup menu; Escape must return focus to it. */
  opener?: HTMLElement | null;
  /** Also check type-ahead (listbox, menu): a printable key moves to the item starting with it. */
  typeahead?: boolean;
  /** Rule ids to waive. A waiver is visible in the test, never silent. */
  skip?: readonly string[];
  /** Key driver, e.g. `(key) => userEvent.keyboard(`{${key}}`)`. Default: synthetic events. */
  press?: (key: string) => void | Promise<void>;
}

const LINEAR = ['items', 'one-tab-stop', 'key-home', 'key-end', 'key-next', 'key-prev'] as const;
const COMMON = ['role', 'name', 'focus-not-lost'] as const;
/** Every rule a pattern can report; the self-test proves one failing fixture per rule. */
export const PATTERN_RULES: Readonly<Record<Pattern, readonly string[]>> = {
  listbox: [...COMMON, ...LINEAR, 'option-state', 'typeahead'],
  menu: [...COMMON, ...LINEAR, 'typeahead', 'escape-closes', 'focus-return'],
  tabs: [...COMMON, ...LINEAR, 'key-wrap', 'tab-selected', 'tab-panel'],
  dialog: [...COMMON, 'modal', 'focus-inside', 'escape-closes', 'focus-return'],
  alertdialog: [...COMMON, 'modal', 'description', 'focus-inside', 'escape-closes', 'focus-return'],
  combobox: [
    ...COMMON,
    'expanded-state',
    'key-open',
    'controls',
    'one-tab-stop',
    'focus-stays',
    'active-descendant',
    'escape-closes',
  ],
  grid: [
    ...COMMON,
    'items',
    'one-tab-stop',
    'key-right',
    'key-left',
    'key-down',
    'key-up',
    'key-home',
    'key-end',
    'key-ctrl-home',
    'key-ctrl-end',
  ],
};

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';
const MENU_ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const CELL = '[role="gridcell"], [role="columnheader"], [role="rowheader"]';

function describe(el: Element | null | undefined): string {
  if (!el) return '(none)';
  const role = el.getAttribute('role');
  const name = accessibleName(el) || (el.textContent ?? '').trim();
  return (
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : '') +
    (role ? `[role=${role}]` : '') +
    (name ? `"${name.slice(0, 40)}"` : '')
  );
}

function isHidden(el: Element): boolean {
  if (el.closest('[inert], [hidden], [aria-hidden="true"]')) return true;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  if (view.getComputedStyle(el).visibility === 'hidden') return true;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return true;
  }
  return false;
}

function isClosed(el: Element): boolean {
  return !el.isConnected || isHidden(el) || (el.tagName === 'DIALOG' && !el.hasAttribute('open'));
}

function isDisabled(el: Element): boolean {
  return el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled');
}

function tabStops(root: Element): HTMLElement[] {
  return [root, ...root.querySelectorAll(FOCUSABLE)].filter((el): el is HTMLElement => {
    if (!el.matches(FOCUSABLE) || el.hasAttribute('disabled') || isHidden(el)) return false;
    const attr = el.getAttribute('tabindex');
    return attr === null || Number.parseInt(attr, 10) >= 0;
  });
}

function byIds(el: Element, attribute: string): Element[] {
  return (el.getAttribute(attribute) ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((id) => el.ownerDocument.getElementById(id) ?? []);
}

function accessibleName(el: Element): string {
  const labelled = byIds(el, 'aria-labelledby')
    .map((node) => node.textContent ?? '')
    .join(' ')
    .trim();
  if (labelled) return labelled;
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) return (labels[0].textContent ?? '').trim();
  return el.getAttribute('title')?.trim() ?? '';
}

function find(root: Element, selector: string): HTMLElement | null {
  return root.matches(selector) ? (root as HTMLElement) : root.querySelector(selector);
}

class Run {
  readonly problems: PatternProblem[] = [];
  private readonly skip: ReadonlySet<string>;
  constructor(
    readonly doc: Document,
    private readonly options: PatternOptions,
  ) {
    this.skip = new Set(options.skip ?? []);
  }

  fail(rule: string, expected: string, el: Element | null | undefined): void {
    if (!this.skip.has(rule)) this.problems.push({ rule, expected, element: describe(el) });
  }

  /** Require a non-empty accessible name. */
  name(el: Element, what: string): void {
    if (!accessibleName(el))
      this.fail('name', `${what} has an accessible name (aria-labelledby or aria-label)`, el);
  }

  async press(key: string): Promise<void> {
    if (this.options.press) await this.options.press(key);
    else {
      const parts = key.split('+');
      const init = {
        key: parts[parts.length - 1],
        ctrlKey: parts.includes('Control'),
        bubbles: true,
        cancelable: true,
      };
      const target = this.doc.activeElement ?? this.doc.body;
      target.dispatchEvent(new KeyboardEvent('keydown', init));
      target.dispatchEvent(new KeyboardEvent('keyup', init));
    }
    // One frame + one task: Svelte flushes on a microtask, focus managers often on rAF.
    await new Promise<void>((resolve) => {
      const view = this.doc.defaultView;
      if (view?.requestAnimationFrame) view.requestAnimationFrame(() => setTimeout(resolve, 0));
      else setTimeout(resolve, 0);
    });
    const focused = this.doc.activeElement;
    if (!focused || focused === this.doc.body || isHidden(focused))
      this.fail(
        'focus-not-lost',
        `after ${key}, focus stays on a visible element (never the document body or inert/hidden content)`,
        focused,
      );
  }

  /** The item the user is on: aria-activedescendant target, else the focused item. */
  active(itemSelector: string): Element | null {
    const focused = this.doc.activeElement;
    if (!focused) return null;
    const descendant = byIds(focused, 'aria-activedescendant')[0];
    return descendant ?? focused.closest(itemSelector);
  }

  /** Press `key`; the active item must be one of `candidates`. Returns the active item. */
  async expectKey(
    rule: string,
    key: string,
    itemSelector: string,
    candidates: readonly (Element | undefined)[],
    what: string,
  ): Promise<Element | null> {
    await this.press(key);
    const active = this.active(itemSelector);
    if (!active || !candidates.includes(active)) this.fail(rule, `${key} moves to ${what}`, active);
    return active;
  }

  /** Escape must close `popup` and, when an opener is known, return focus to it. */
  async escape(popup: Element, what: string, requireOpener: boolean): Promise<void> {
    const opener = this.options.opener;
    if (!opener && requireOpener)
      this.fail(
        'focus-return',
        `pass { opener } so focus return on close can be checked for ${what}`,
        popup,
      );
    await this.press('Escape');
    if (!isClosed(popup)) this.fail('escape-closes', `Escape closes ${what}`, popup);
    else if (opener && this.doc.activeElement !== opener)
      this.fail(
        'focus-return',
        `focus returns to the opener when ${what} closes`,
        this.doc.activeElement,
      );
  }
}

async function linear(
  run: Run,
  container: HTMLElement,
  itemSelector: string,
  what: string,
  options: { horizontal: boolean; wrap: boolean; typeahead: boolean },
): Promise<void> {
  const items = [...container.querySelectorAll(itemSelector)].filter((el) => !isHidden(el));
  if (items.length === 0) {
    run.fail('items', `the ${what} contains at least one item (${itemSelector})`, container);
    return;
  }
  const stops = tabStops(container);
  if (stops.length !== 1)
    run.fail(
      'one-tab-stop',
      `exactly one tab stop in the ${what} (roving tabindex or aria-activedescendant); found ${stops.length}: ${stops.map(describe).join(', ') || 'none'}`,
      container,
    );
  if (stops.length === 0) return;
  stops[0].focus();

  const enabled = items.filter((el) => !isDisabled(el));
  const [next, prev] = options.horizontal ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp'];
  // APG lets disabled items stay focusable, so "next" is the next item or the next enabled one.
  const after = (from: Element | null, step: 1 | -1) => {
    const index = from ? items.indexOf(from) : -1;
    const ordered = step === 1 ? items.slice(index + 1) : items.slice(0, index).reverse();
    return [ordered[0], ordered.find((el) => !isDisabled(el))];
  };
  const first = [items[0], enabled[0]];
  const last = [items[items.length - 1], enabled[enabled.length - 1]];

  // Home first, unchecked: End and Home are only proven when they have to move.
  await run.press('Home');
  await run.expectKey('key-end', 'End', itemSelector, last, 'the last item');
  let at = await run.expectKey('key-home', 'Home', itemSelector, first, 'the first item');
  if (items.length > 1) {
    at = await run.expectKey('key-next', next, itemSelector, after(at, 1), 'the next item');
    at = await run.expectKey('key-prev', prev, itemSelector, after(at, -1), 'the previous item');
    if (options.wrap)
      await run.expectKey('key-wrap', prev, itemSelector, last, 'the last item from the first one');
  }

  if (options.typeahead) {
    const letter = (el: Element) => (el.textContent ?? '').trim().charAt(0).toLowerCase();
    const target = enabled.find((el) => letter(el) && letter(el) !== letter(enabled[0]));
    if (target) {
      await run.press('Home');
      await run.press(letter(target));
      const active = run.active(itemSelector);
      if (!active || letter(active) !== letter(target))
        run.fail(
          'typeahead',
          `typing "${letter(target)}" moves to the item starting with it`,
          active,
        );
    }
  }
}

async function listbox(run: Run, root: Element, options: PatternOptions): Promise<void> {
  const el = find(root, '[role="listbox"]');
  if (!el) return run.fail('role', 'an element with role="listbox"', root);
  run.name(el, 'the listbox');
  for (const option of el.querySelectorAll('[role="option"]'))
    if (!option.hasAttribute('aria-selected') && !option.hasAttribute('aria-checked'))
      run.fail('option-state', 'every option states aria-selected (or aria-checked)', option);
  await linear(run, el, '[role="option"]', 'listbox', {
    horizontal: options.orientation === 'horizontal',
    wrap: false,
    typeahead: options.typeahead === true,
  });
}

async function menu(run: Run, root: Element, options: PatternOptions): Promise<void> {
  const el = find(root, '[role="menu"]');
  if (!el) return run.fail('role', 'an element with role="menu"', root);
  run.name(el, 'the menu');
  await linear(run, el, MENU_ITEM, 'menu', {
    horizontal: options.orientation === 'horizontal',
    wrap: false,
    typeahead: options.typeahead === true,
  });
  // A menubar-style menu has no opener; a popup menu must close on Escape and return focus.
  if (options.opener) await run.escape(el, 'the menu', false);
}

async function tabs(run: Run, root: Element, options: PatternOptions): Promise<void> {
  const list = find(root, '[role="tablist"]');
  if (!list) return run.fail('role', 'an element with role="tablist"', root);
  run.name(list, 'the tablist');
  const selected = [...list.querySelectorAll('[role="tab"]')].filter(
    (tab) => tab.getAttribute('aria-selected') === 'true',
  );
  if (selected.length !== 1)
    run.fail(
      'tab-selected',
      `exactly one tab has aria-selected="true"; found ${selected.length}`,
      list,
    );
  for (const tab of selected) {
    const panel = byIds(tab, 'aria-controls')[0];
    if (panel?.getAttribute('role') !== 'tabpanel' || !accessibleName(panel))
      run.fail(
        'tab-panel',
        'the selected tab aria-controls a role="tabpanel" that is labelled by its tab',
        panel ?? tab,
      );
  }
  await linear(run, list, '[role="tab"]', 'tablist', {
    horizontal: options.orientation !== 'vertical',
    wrap: true,
    typeahead: false,
  });
}

async function dialog(run: Run, root: Element, alert: boolean): Promise<void> {
  const role = alert ? 'alertdialog' : 'dialog';
  const el = find(root, alert ? '[role="alertdialog"]' : '[role="dialog"], dialog');
  if (!el) return run.fail('role', `an element with role="${role}"`, root);
  run.name(el, `the ${role}`);
  let nativeModal = false;
  try {
    nativeModal = el.tagName === 'DIALOG' && el.matches(':modal');
  } catch {
    // :modal is not implemented by every DOM (happy-dom); aria-modal is then the only proof.
  }
  if (el.getAttribute('aria-modal') !== 'true' && !nativeModal)
    run.fail('modal', `the ${role} is modal (aria-modal="true" or a native modal <dialog>)`, el);
  if (alert && byIds(el, 'aria-describedby').length === 0)
    run.fail('description', 'the alertdialog aria-describedby points at its message', el);
  if (!el.contains(run.doc.activeElement))
    run.fail('focus-inside', `focus starts inside the ${role}`, run.doc.activeElement);
  await run.escape(el, `the ${role}`, true);
}

async function combobox(run: Run, root: Element): Promise<void> {
  const el = find(root, '[role="combobox"]');
  if (!el) return run.fail('role', 'an element with role="combobox"', root);
  run.name(el, 'the combobox');
  if (!el.hasAttribute('aria-expanded'))
    run.fail('expanded-state', 'the combobox states aria-expanded', el);
  el.focus();
  await run.press('ArrowDown');
  if (el.getAttribute('aria-expanded') !== 'true')
    run.fail('key-open', 'ArrowDown opens the popup (aria-expanded="true")', el);
  const popup = byIds(el, 'aria-controls')[0];
  const popupRole = popup?.getAttribute('role') ?? '';
  if (!popup || !['listbox', 'grid', 'tree', 'dialog'].includes(popupRole)) {
    run.fail(
      'controls',
      'while expanded, aria-controls points at the popup (listbox, grid, tree or dialog)',
      popup ?? el,
    );
  } else if (popupRole !== 'dialog') {
    const stops = tabStops(popup);
    if (stops.length > 0)
      run.fail(
        'one-tab-stop',
        `the combobox is the only tab stop; the popup has ${stops.length}: ${stops.map(describe).join(', ')}`,
        popup,
      );
    // APG: ArrowDown may only open; a second press must then reach the first option.
    if (byIds(el, 'aria-activedescendant').length === 0) await run.press('ArrowDown');
    if (run.doc.activeElement !== el)
      run.fail(
        'focus-stays',
        'DOM focus stays on the combobox while the popup is navigated',
        run.doc.activeElement,
      );
    const active = byIds(el, 'aria-activedescendant')[0];
    if (!active || !popup.contains(active))
      run.fail(
        'active-descendant',
        'ArrowDown sets aria-activedescendant to an item inside the popup',
        active ?? el,
      );
  }
  await run.press('Escape');
  if (el.getAttribute('aria-expanded') !== 'false')
    run.fail('escape-closes', 'Escape closes the popup (aria-expanded="false")', el);
}

async function grid(run: Run, root: Element): Promise<void> {
  const el = find(root, '[role="grid"]');
  if (!el) return run.fail('role', 'an element with role="grid"', root);
  run.name(el, 'the grid');
  const rows = [...el.querySelectorAll('[role="row"]')]
    .filter((row) => !isHidden(row))
    .map((row) => [...row.querySelectorAll(CELL)])
    .filter((cells) => cells.length > 0);
  if (rows.length === 0) {
    run.fail('items', 'the grid contains rows of gridcell/columnheader/rowheader', el);
    return;
  }
  const stops = tabStops(el);
  if (stops.length !== 1)
    run.fail(
      'one-tab-stop',
      `exactly one tab stop in the grid (controls inside cells use tabindex="-1"); found ${stops.length}: ${
        stops.slice(0, 5).map(describe).join(', ') || 'none'
      }`,
      el,
    );
  if (stops.length === 0) return;
  stops[0].focus();

  // Header rows may or may not be navigable: Ctrl+Home lands on the first cell of the first
  // row that is, and every later expectation is relative to that row.
  const dataRow = rows.findIndex((cells) => cells.some((c) => c.matches('[role="gridcell"]')));
  const lastRow = rows[rows.length - 1];
  await run.expectKey(
    'key-ctrl-end',
    'Control+End',
    CELL,
    [lastRow[lastRow.length - 1]],
    'the last cell of the last row',
  );
  const start = await run.expectKey(
    'key-ctrl-home',
    'Control+Home',
    CELL,
    [rows[0][0], rows[Math.max(dataRow, 0)][0]],
    'the first cell of the first row',
  );
  const top = Math.max(
    rows.findIndex((cells) => start !== null && cells.includes(start)),
    0,
  );
  const row = rows[top];
  if (row.length > 1) {
    await run.expectKey('key-right', 'ArrowRight', CELL, [row[1]], 'the next cell in the row');
    await run.expectKey('key-left', 'ArrowLeft', CELL, [row[0]], 'the previous cell in the row');
  }
  if (rows.length > top + 1) {
    await run.expectKey('key-down', 'ArrowDown', CELL, [rows[top + 1][0]], 'the cell below');
    await run.expectKey('key-up', 'ArrowUp', CELL, [row[0]], 'the cell above');
  }
  await run.expectKey('key-end', 'End', CELL, [row[row.length - 1]], 'the last cell in the row');
  await run.expectKey('key-home', 'Home', CELL, [row[0]], 'the first cell in the row');
}

/** Check `root` (or the first matching descendant) against an APG pattern; returns every problem. */
export async function checkPattern(
  root: Element,
  pattern: Pattern,
  options: PatternOptions = {},
): Promise<PatternProblem[]> {
  const run = new Run(root.ownerDocument, options);
  if (pattern === 'listbox') await listbox(run, root, options);
  else if (pattern === 'menu') await menu(run, root, options);
  else if (pattern === 'tabs') await tabs(run, root, options);
  else if (pattern === 'combobox') await combobox(run, root);
  else if (pattern === 'grid') await grid(run, root);
  else await dialog(run, root, pattern === 'alertdialog');
  return run.problems;
}

/** Throws one Error listing every broken expectation; resolves when the widget conforms. */
export async function assertPattern(
  root: Element,
  pattern: Pattern,
  options: PatternOptions = {},
): Promise<void> {
  const problems = await checkPattern(root, pattern, options);
  if (problems.length === 0) return;
  throw new Error(
    `assertPattern(${pattern}): ${problems.length} problem(s)\n` +
      problems.map((p) => `  - [${p.rule}] ${p.expected} — got ${p.element}`).join('\n'),
  );
}
