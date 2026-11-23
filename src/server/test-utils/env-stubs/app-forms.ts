import type { SubmitFunction } from '@sveltejs/kit';

/**
 * Mount-only `$app/forms` seam. Branding tests render the real form component;
 * they do not qualify SvelteKit submission/navigation. Fail an accidental submit
 * explicitly instead of issuing a request against an unqualified backend.
 */
export function enhance(form: HTMLFormElement, _submit?: SubmitFunction) {
  const rejectUnexpectedSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    throw new Error('Form submission requires a SvelteKit runtime test.');
  };
  form.addEventListener('submit', rejectUnexpectedSubmit);
  return { destroy: () => form.removeEventListener('submit', rejectUnexpectedSubmit) };
}
