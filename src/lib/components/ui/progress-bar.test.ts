import { render } from 'svelte/server';
import { describe, expect, test } from 'vitest';
import ProgressBar from './ProgressBar.svelte';

describe('ProgressBar', () => {
  test('clamps value > max instead of letting zag throw', () => {
    // The regression this primitive exists to kill: a backend reporting
    // processed (2001) past total (2000) made zag's progress machine throw
    // uncaught and break client-side navigation.
    const { body } = render(ProgressBar, { props: { value: 2001, max: 2000 } });
    expect(body).toContain('aria-valuenow="2000"');
    expect(body).toContain('aria-valuemax="2000"');
  });

  test('clamps negative values to zero', () => {
    const { body } = render(ProgressBar, { props: { value: -5, max: 100 } });
    expect(body).toContain('aria-valuenow="0"');
  });

  test('null value renders the indeterminate sweep, not a static fill', () => {
    const { body } = render(ProgressBar, { props: { value: null } });
    expect(body).toContain('indeterminate');
    expect(body).not.toContain('aria-valuenow');
  });

  test('switches to the success ramp at 100%', () => {
    const done = render(ProgressBar, { props: { value: 100, max: 100 } });
    expect(done.body).toContain('complete');
    const partial = render(ProgressBar, { props: { value: 40, max: 100 } });
    expect(partial.body).not.toContain('complete');
  });

  test('exposes progressbar semantics with the caller label', () => {
    const { body } = render(ProgressBar, { props: { value: 3, max: 10, label: 'Syncing' } });
    expect(body).toContain('role="progressbar"');
    expect(body).toContain('aria-label="Syncing"');
    expect(body).toContain('aria-valuemin="0"');
  });

  test('falls back to max 100 when max is non-positive', () => {
    const { body } = render(ProgressBar, { props: { value: 50, max: 0 } });
    expect(body).toContain('aria-valuemax="100"');
    expect(body).toContain('aria-valuenow="50"');
  });

  test('renders queued progress beneath acknowledged progress in one track', () => {
    const { body } = render(ProgressBar, {
      props: { value: 60, bufferedValue: 100, max: 100, tone: 'success' },
    });
    expect(body).toContain('data-progress-buffer="pending"');
    expect(body).toContain('width: 100%');
    expect(body).toContain('success');
    expect(body.match(/role="progressbar"/g)).toHaveLength(1);
  });
});
