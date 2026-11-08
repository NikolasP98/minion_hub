import type { Decorator, Preview } from '@storybook/sveltekit';
import { DecoratorHelpers } from '@storybook/addon-themes';
import '../src/app.css';
import './preview.css';
import { applyTheme } from '../src/lib/themes/runtime';
import { ACCENT_OPTIONS, PRESETS } from '../src/lib/themes/presets';

const { initializeThemeState, pluckThemeFromContext } = DecoratorHelpers;

const DEFAULT_THEME = PRESETS[0].id;
const DEFAULT_ACCENT = ACCENT_OPTIONS[0].id;

// addon-themes owns the "theme" toolbar; the decorator applies the hub's own
// runtime (data-minion-theme + inline accent vars) so stories match the app.
initializeThemeState(
  PRESETS.map((p) => p.id),
  DEFAULT_THEME,
);

const withHubTheme: Decorator = (storyFn, context) => {
  const themeId = pluckThemeFromContext(context) || DEFAULT_THEME;
  const accentId = (context.globals.accent as string) || DEFAULT_ACCENT;
  const preset = PRESETS.find((p) => p.id === themeId) ?? PRESETS[0];
  const accent = ACCENT_OPTIONS.find((a) => a.id === accentId) ?? ACCENT_OPTIONS[0];
  applyTheme(preset, accent.value);
  document.body.style.background = 'var(--color-canvas)';
  return storyFn();
};

const preview: Preview = {
  decorators: [withHubTheme],
  globalTypes: {
    accent: {
      description: 'Hub accent colour',
      toolbar: {
        title: 'Accent',
        icon: 'paintbrush',
        items: ACCENT_OPTIONS.map((a) => ({ value: a.id, title: a.label })),
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    backgrounds: { disable: true },
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
    accent: DEFAULT_ACCENT,
  },
};

export default preview;
