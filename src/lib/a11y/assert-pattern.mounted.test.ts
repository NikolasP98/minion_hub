// @vitest-environment happy-dom
/**
 * assertPattern self-test (spec 137 FR-007, SC-003): one passing fixture per pattern and
 * one failing fixture per asserted rule. The fixtures are minimal vanilla widgets that
 * implement the APG keyboard contract; `broken` removes exactly one behavior.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPattern,
  checkPattern,
  PATTERN_RULES,
  type Pattern,
  type PatternOptions,
} from './assert-pattern';

type Built = { root: HTMLElement; options?: PatternOptions };
type Build = (broken?: string) => Built;

const h = (tag: string, attrs: Record<string, string> = {}, text = ''): HTMLElement => {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.textContent = text;
  return el;
};
const loseFocus = () => (document.activeElement as HTMLElement | null)?.blur();

/** Roving-tabindex composite shared by listbox, menu and tabs. */
function roving(
  container: HTMLElement,
  items: HTMLElement[],
  o: { next: string; prev: string; wrap?: boolean; broken?: string },
): void {
  const go = (index: number) => {
    const to = o.wrap ? (index + items.length) % items.length : index;
    if (!items[to]) return;
    items.forEach((item, i) => item.setAttribute('tabindex', i === to ? '0' : '-1'));
    items[to].focus();
  };
  items.forEach((item, i) => item.setAttribute('tabindex', i === 0 ? '0' : '-1'));
  if (o.broken === 'one-tab-stop') items[1].setAttribute('tabindex', '0');
  container.addEventListener('keydown', (event) => {
    const at = items.indexOf(document.activeElement as HTMLElement);
    const key = event.key;
    if (key === 'Home' && o.broken !== 'key-home') go(0);
    else if (key === 'End' && o.broken !== 'key-end') go(items.length - 1);
    else if (key === o.next && o.broken !== 'key-next') {
      if (o.broken === 'focus-not-lost') loseFocus();
      else go(at + 1);
    } else if (key === o.prev && o.broken !== 'key-prev') {
      if (at > 0 || o.broken !== 'key-wrap') go(at - 1);
    } else if (key.length === 1 && o.broken !== 'typeahead')
      go(items.findIndex((item) => item.textContent?.toLowerCase().startsWith(key)));
  });
}

const mount = (...nodes: HTMLElement[]): HTMLElement => {
  const root = h('div');
  root.append(...nodes);
  document.body.append(root);
  return root;
};

const listbox: Build = (broken) => {
  const el = h('div', broken === 'role' ? {} : { role: 'listbox' });
  if (broken !== 'name') el.setAttribute('aria-label', 'Fruit');
  const items =
    broken === 'items'
      ? []
      : ['Apple', 'Banana', 'Cherry'].map((text) =>
          h(
            'div',
            { role: 'option', ...(broken === 'option-state' ? {} : { 'aria-selected': 'false' }) },
            text,
          ),
        );
  el.append(...items);
  if (items.length) roving(el, items, { next: 'ArrowDown', prev: 'ArrowUp', broken });
  return { root: mount(el), options: { typeahead: true } };
};

const menu: Build = (broken) => {
  const opener = h('button', {}, 'Actions');
  const el = h('div', broken === 'role' ? {} : { role: 'menu' });
  if (broken !== 'name') el.setAttribute('aria-label', 'Actions');
  const items =
    broken === 'items'
      ? []
      : ['Copy', 'Delete', 'Rename'].map((t) => h('div', { role: 'menuitem' }, t));
  el.append(...items);
  if (items.length) roving(el, items, { next: 'ArrowDown', prev: 'ArrowUp', broken });
  const other = h('button', {}, 'Other');
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || broken === 'escape-closes') return;
    el.remove();
    (broken === 'focus-return' ? other : opener).focus();
  });
  return { root: mount(opener, other, el), options: { opener, typeahead: true } };
};

const tabs: Build = (broken) => {
  const list = h('div', broken === 'role' ? {} : { role: 'tablist' });
  if (broken !== 'name') list.setAttribute('aria-label', 'Sections');
  const items =
    broken === 'items'
      ? []
      : ['One', 'Two', 'Three'].map((text, i) =>
          h(
            'button',
            {
              role: 'tab',
              id: `tab-${i}`,
              'aria-controls': `panel-${i}`,
              'aria-selected': String(i === 0 && broken !== 'tab-selected'),
            },
            text,
          ),
        );
  list.append(...items);
  if (items.length)
    roving(list, items, { next: 'ArrowRight', prev: 'ArrowLeft', wrap: true, broken });
  const panel = h(
    'div',
    {
      id: 'panel-0',
      'aria-labelledby': 'tab-0',
      ...(broken === 'tab-panel' ? {} : { role: 'tabpanel' }),
    },
    'Panel one',
  );
  return { root: mount(list, panel) };
};

const dialogOf =
  (role: 'dialog' | 'alertdialog'): Build =>
  (broken) => {
    const opener = h('button', {}, 'Open');
    const el = h('div', broken === 'role' ? {} : { role });
    if (broken !== 'name') el.setAttribute('aria-label', 'Confirm');
    if (broken !== 'modal') el.setAttribute('aria-modal', 'true');
    const message = h('p', { id: 'message' }, 'Delete this record?');
    if (broken !== 'description') el.setAttribute('aria-describedby', 'message');
    const ok = h('button', {}, 'OK');
    el.append(message, ok);
    const other = h('button', {}, 'Other');
    const root = mount(opener, other, el);
    (broken === 'focus-inside' ? other : ok).focus();
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || broken === 'escape-closes') return;
      el.remove();
      if (broken === 'focus-not-lost') loseFocus();
      else (broken === 'focus-return' ? other : opener).focus();
    });
    return { root, options: { opener } };
  };

const combobox: Build = (broken) => {
  const input = h('input', broken === 'role' ? {} : { role: 'combobox' });
  if (broken !== 'name') input.setAttribute('aria-label', 'City');
  if (broken !== 'expanded-state') input.setAttribute('aria-expanded', 'false');
  const popup = h('div', {
    id: 'cities',
    hidden: '',
    ...(broken === 'controls' ? {} : { role: 'listbox' }),
  });
  const options = ['Lima', 'Cusco'].map((text, i) =>
    h(
      'div',
      { role: 'option', id: `city-${i}`, ...(broken === 'one-tab-stop' ? { tabindex: '0' } : {}) },
      text,
    ),
  );
  popup.append(...options);
  input.setAttribute('aria-controls', 'cities');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && broken !== 'key-open') {
      input.setAttribute('aria-expanded', 'true');
      popup.removeAttribute('hidden');
      if (broken === 'focus-stays') (options[0].setAttribute('tabindex', '-1'), options[0].focus());
      else if (broken === 'focus-not-lost') loseFocus();
      else if (broken !== 'active-descendant')
        input.setAttribute('aria-activedescendant', 'city-0');
    } else if (event.key === 'Escape' && broken !== 'escape-closes') {
      input.setAttribute('aria-expanded', 'false');
      popup.setAttribute('hidden', '');
    }
  });
  // `focus-stays` moves DOM focus into the popup, so its Escape must be heard there too.
  popup.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') input.setAttribute('aria-expanded', 'false');
  });
  return { root: mount(input, popup) };
};

const grid: Build = (broken) => {
  const el = h('div', broken === 'role' ? {} : { role: 'grid' });
  if (broken !== 'name') el.setAttribute('aria-label', 'Customers');
  const rows =
    broken === 'items'
      ? []
      : [0, 1, 2].map((r) => {
          const row = h('div', { role: 'row' });
          row.append(
            ...[0, 1, 2].map((c) => h('div', { role: 'gridcell', tabindex: '-1' }, `${r}:${c}`)),
          );
          return row;
        });
  el.append(...rows);
  const cells = rows.map((row) => [...row.children] as HTMLElement[]);
  const go = (r: number, c: number) => {
    const to = cells[r]?.[c];
    if (!to) return;
    cells.flat().forEach((cell) => cell.setAttribute('tabindex', cell === to ? '0' : '-1'));
    to.focus();
  };
  if (cells.length) {
    cells[0][0].setAttribute('tabindex', '0');
    if (broken === 'one-tab-stop') cells[1][1].setAttribute('tabindex', '0');
  }
  el.addEventListener('keydown', (event) => {
    const r = cells.findIndex((row) => row.includes(document.activeElement as HTMLElement));
    const c = cells[r]?.indexOf(document.activeElement as HTMLElement) ?? 0;
    const key = `${event.ctrlKey ? 'ctrl-' : ''}${event.key.replace('Arrow', '').toLowerCase()}`;
    if (broken === `key-${key}`) return;
    if (key === 'right') broken === 'focus-not-lost' ? loseFocus() : go(r, c + 1);
    else if (key === 'left') go(r, c - 1);
    else if (key === 'down') go(r + 1, c);
    else if (key === 'up') go(r - 1, c);
    else if (key === 'home') go(r, 0);
    else if (key === 'end') go(r, cells[r].length - 1);
    else if (key === 'ctrl-home') go(0, 0);
    else if (key === 'ctrl-end') go(cells.length - 1, cells[cells.length - 1].length - 1);
  });
  return { root: mount(el) };
};

const FIXTURES: Record<Pattern, Build> = {
  listbox,
  menu,
  tabs,
  dialog: dialogOf('dialog'),
  alertdialog: dialogOf('alertdialog'),
  combobox,
  grid,
};

afterEach(() => document.body.replaceChildren());

describe.each(Object.keys(FIXTURES) as Pattern[])('assertPattern(%s)', (pattern) => {
  it('passes a conforming widget', async () => {
    const { root, options } = FIXTURES[pattern]();
    await expect(assertPattern(root, pattern, options)).resolves.toBeUndefined();
  });

  it.each(PATTERN_RULES[pattern])('reports a widget that breaks "%s"', async (rule) => {
    const { root, options } = FIXTURES[pattern](rule);
    const problems = await checkPattern(root, pattern, options);
    expect(problems.map((problem) => problem.rule)).toContain(rule);
  });
});

describe('assertPattern reporting', () => {
  it('collects every problem in one error, naming rule, expectation and element', async () => {
    const el = h('div', { role: 'listbox' });
    el.append(
      h('div', { role: 'option', tabindex: '0' }, 'A'),
      h('div', { role: 'option', tabindex: '0' }, 'B'),
    );
    const error = await assertPattern(mount(el), 'listbox').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/^assertPattern\(listbox\): \d+ problem\(s\)/);
    expect(message).toContain('[name]');
    expect(message).toContain('[one-tab-stop] exactly one tab stop');
    expect(message).toContain('div[role=option]"A", div[role=option]"B"');
    expect(message).toContain('[option-state]');
  });

  it('waives a rule only when it is named in skip', async () => {
    const { root } = listbox('name');
    expect((await checkPattern(root, 'listbox')).map((p) => p.rule)).toEqual(['name']);
    expect(await checkPattern(root, 'listbox', { skip: ['name'] })).toEqual([]);
  });

  it('requires an opener to prove focus return for dialogs', async () => {
    const { root } = dialogOf('dialog')();
    const problems = await checkPattern(root, 'dialog');
    expect(problems.map((p) => p.rule)).toContain('focus-return');
  });

  it('accepts aria-activedescendant as the single tab stop', async () => {
    const el = h('div', { role: 'listbox', 'aria-label': 'Fruit', tabindex: '0' });
    const items = ['Apple', 'Banana'].map((text, i) =>
      h('div', { role: 'option', id: `o-${i}`, 'aria-selected': 'false' }, text),
    );
    el.append(...items);
    const set = (i: number) => items[i] && el.setAttribute('aria-activedescendant', `o-${i}`);
    el.addEventListener('keydown', (event) => {
      const at = Number((el.getAttribute('aria-activedescendant') ?? 'o-0').slice(2));
      if (event.key === 'Home') set(0);
      else if (event.key === 'End') set(items.length - 1);
      else if (event.key === 'ArrowDown') set(at + 1);
      else if (event.key === 'ArrowUp') set(at - 1);
    });
    expect(await checkPattern(mount(el), 'listbox')).toEqual([]);
  });
});
