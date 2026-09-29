// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import GroupByPicker from './GroupByPicker.svelte';

afterEach(() => cleanup());

const options = [
  { value: 'category', label: 'Category' },
  { value: 'zone', label: 'Zone' },
];

describe('GroupByPicker (spec 2026-09-29 table-toolbar)', () => {
  it("idle (value ''): icon-only — no visible label, no clear affordance", () => {
    const { container } = render(GroupByPicker, {
      props: { options, value: '', onChange: () => {} },
    });
    expect(container.querySelector('.gbp-label')).toBeNull();
    expect(container.querySelector('.gbp-clear')).toBeNull();
  });

  it('active: shows the selected option label in an accent pill', () => {
    const { container } = render(GroupByPicker, {
      props: { options, value: 'zone', onChange: () => {} },
    });
    expect(container.querySelector('.gbp-label')?.textContent).toBe('Zone');
    expect(container.querySelector('.gbp.active')).not.toBeNull();
  });

  it('the × clears the grouping without opening the dropdown', async () => {
    const onChange = vi.fn();
    const { container } = render(GroupByPicker, {
      props: { options, value: 'zone', onChange },
    });
    const clearBtn = container.querySelector('.gbp-clear') as HTMLElement;
    expect(clearBtn).not.toBeNull();
    await fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('');
    // clicking × must not also open the Dropdown menu
    const trigger = container.querySelector('.gbp-btn')?.closest('button');
    expect(trigger?.getAttribute('aria-expanded')).not.toBe('true');
  });

  it('clicking anywhere else on the pill opens the option list', async () => {
    const { container } = render(GroupByPicker, {
      props: { options, value: '', onChange: () => {}, noneLabel: 'Flat' },
    });
    const trigger = container.querySelector('.gbp-btn')?.closest('button') as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).not.toBe('true');
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // "No grouping" (noneLabel) is listed first, ahead of the real options.
    expect(document.body.textContent).toContain('Flat');
    expect(document.body.textContent).toContain('Category');
  });
});
