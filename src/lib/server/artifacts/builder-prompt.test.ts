import { describe, it, expect } from 'vitest';
import { buildBuilderPrompt, extractHtml, validateBundle } from './builder-prompt';
import type { VariableSpec } from '$lib/flows/master-flows';

describe('extractHtml', () => {
  it('strips ```html fences', () => {
    expect(extractHtml('```html\n<!doctype html><html></html>\n```')).toBe('<!doctype html><html></html>');
  });
  it('strips prose before the doctype', () => {
    expect(extractHtml('Here is your artifact:\n<!doctype html><html></html>')).toBe('<!doctype html><html></html>');
  });
  it('returns raw html unchanged', () => {
    expect(extractHtml('<!doctype html><html></html>')).toBe('<!doctype html><html></html>');
  });
});
describe('validateBundle', () => {
  it('passes a bundle that uses the bridge', () => {
    expect(() => validateBundle("<html><script>bridge.call('hub.artifact.context.get')</script></html>")).not.toThrow();
  });
  it('throws on empty', () => { expect(() => validateBundle('   ')).toThrow(); });
  it('throws when the bridge call is missing', () => { expect(() => validateBundle('<html><body>hi</body></html>')).toThrow(); });
});
describe('buildBuilderPrompt', () => {
  it('includes the agent name, every schema key, and the user prompt', () => {
    const schema: VariableSpec[] = [{ key: 'reminders.sent', type: 'int', label: 'Sent', sample: 42 }];
    const p = buildBuilderPrompt({ agent: { name: 'Reminders', role: 'Appt', trigger: 'cron' }, schema, userPrompt: 'a sent/failed card', reference: '<!doctype html>' });
    expect(p).toContain('Reminders');
    expect(p).toContain('reminders.sent');
    expect(p).toContain('a sent/failed card');
  });
});
