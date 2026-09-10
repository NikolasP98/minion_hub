import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import SecretEditModal from './SecretEditModal.svelte';
import ImageLightbox from '../my-agent/ImageLightbox.svelte';

describe('modal consumer contracts', () => {
  it('renders a named native secret dialog with its password control', () => {
    const html = render(SecretEditModal, {
      props: {
        open: true,
        secretKey: 'PROVIDER_KEY',
        secretLabel: 'Provider credential',
        onClose: vi.fn(),
        onSave: vi.fn(),
      },
    }).body;
    expect(html).toMatch(/<dialog\b/);
    expect(html).toMatch(/aria-labelledby="[^"]+-title"/);
    expect(html).toContain('Provider credential');
    expect(html).toContain('PROVIDER_KEY');
    expect(html).toContain('type="password"');
  });

  it('renders an image in a native named dialog without replacing its source', () => {
    const html = render(ImageLightbox, {
      props: { src: '/preview.png', onclose: vi.fn() },
    }).body;
    expect(html).toMatch(/<dialog\b/);
    expect(html).toMatch(/aria-labelledby="[^"]+-title"/);
    expect(html).toContain('src="/preview.png"');
    expect(html).toContain('data-part="close-trigger"');
  });

  it('does not render a preview or dialog while no image is selected', () => {
    const html = render(ImageLightbox, { props: { src: null, onclose: vi.fn() } }).body;
    expect(html).not.toMatch(/<dialog\b|<img\b/);
  });
});
