// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import DataSource from './DataSource.svelte';

afterEach(() => cleanup());

const children = createRawSnippet((value: () => unknown) => ({
  render: () => `<p data-testid="body">${(value() as string[]).join(',')}</p>`,
}));

describe('DataSource', () => {
  it('renders the forbidden state naming the dataset when denied', () => {
    render(DataSource, {
      props: { value: { denied: 'pos', verb: 'view' }, module: 'pos', children },
    });
    expect(screen.getByRole('region').textContent).toContain("Your role can't view Point of Sale");
    expect(screen.queryByTestId('body')).toBeNull();
  });

  it('renders children with the value when allowed', () => {
    render(DataSource, { props: { value: ['a', 'b'], module: 'pos', children } });
    expect(screen.getByTestId('body').textContent).toBe('a,b');
  });

  it('compact denied renders one caption line', () => {
    const { container } = render(DataSource, {
      props: { value: { denied: 'pos', verb: 'view' }, compact: true, children },
    });
    const line = container.querySelector('[data-component="data-source"]');
    expect(line?.textContent?.trim()).toBe("Your role can't view Point of Sale");
    expect(screen.queryByRole('region')).toBeNull();
  });
});
