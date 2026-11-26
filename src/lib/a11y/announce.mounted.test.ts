// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { announce } from './announce';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
afterEach(() => (document.body.innerHTML = ''));

describe('announce', () => {
  it('speaks through one live region per politeness and repeats identical text', async () => {
    announce('Saved');
    await frame();
    announce('Saved');
    const polite = document.querySelectorAll('[data-announcer="polite"]');
    expect(polite).toHaveLength(1);
    expect(polite[0].textContent).toBe(''); // cleared, so the repeat is spoken again
    await frame();
    expect(polite[0].textContent).toBe('Saved');
    expect(polite[0].getAttribute('aria-live')).toBe('polite');

    announce('Picked up', 'assertive');
    await frame();
    expect(document.querySelector('[data-announcer="assertive"]')?.textContent).toBe('Picked up');
  });

  it('moves into the open modal dialog, where the rest of the page is inert', async () => {
    announce('Outside');
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    announce('Inside');
    await frame();
    expect(dialog.querySelector('[data-announcer="polite"]')?.textContent).toBe('Inside');
    dialog.remove();
    announce('Back');
    expect(document.body.querySelector(':scope > [data-announcer="polite"]')).not.toBeNull();
  });
});
