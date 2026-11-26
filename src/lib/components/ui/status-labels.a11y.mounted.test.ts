// @vitest-environment happy-dom
/**
 * Spec 152 PR D — a remove button says what it removes; a loading placeholder can be
 * announced. (The icon-only button rule is tested in scripts/design-lint.test.ts.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import Fixture from './status-labels.a11y.fixture.svelte';

afterEach(cleanup);

describe('remove buttons name their target (spec 152)', () => {
  it('each chip × is "Remove <chip text>", so two chips are told apart', () => {
    render(Fixture);
    expect(screen.getByRole('button', { name: 'Remove Paid' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Draft' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag VIP' })).toBeTruthy();
  });
});

describe('Skeleton label (spec 152)', () => {
  it('is hidden without a label and a status with one', () => {
    const { container } = render(Fixture);
    const parts = [...container.querySelectorAll('[data-part="skeleton"]')];
    expect(parts[0].getAttribute('aria-hidden')).toBe('true');
    expect(parts[1].getAttribute('role')).toBe('status');
    expect(screen.getByRole('status', { name: 'Loading customers' })).toBe(parts[1]);
  });
});
