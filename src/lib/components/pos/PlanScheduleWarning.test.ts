// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import PlanScheduleWarning from './PlanScheduleWarning.svelte';

afterEach(cleanup);

describe('PlanScheduleWarning', () => {
  it('truthfully retains manual collection guidance for an invalid legacy schedule', () => {
    const view = render(PlanScheduleWarning, { props: { issue: 'principal_mismatch' } });
    expect(view.getByRole('alert').textContent).toContain('needs correction');
    expect(view.getByRole('alert').textContent).toContain('manual collection');
  });

  it('renders nothing for a valid or absent schedule', () => {
    const view = render(PlanScheduleWarning, { props: { issue: null } });
    expect(view.queryByRole('alert')).toBeNull();
  });
});
