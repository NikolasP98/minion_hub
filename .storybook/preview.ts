import type { Preview } from '@storybook/sveltekit';
import '../src/app.css';
import './preview.css';
import { applyTheme } from '../src/lib/themes/runtime';
import { ACCENT_OPTIONS, PRESETS } from '../src/lib/themes/presets';

// Same <html> attributes + inline vars the app sets at runtime: new-york (dark), blue accent.
applyTheme(PRESETS[0], ACCENT_OPTIONS[0].value);

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        canvas: { name: 'Canvas', value: 'var(--color-canvas)' },
        surface: { name: 'Surface', value: 'var(--color-surface-1)' },
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
  initialGlobals: {
    backgrounds: { value: 'canvas' },
  },
};

export default preview;
