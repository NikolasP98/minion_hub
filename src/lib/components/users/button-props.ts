import type { ButtonProps } from '@minion-stack/ui';

/**
 * Zag emits DOM-compatible nullable attributes, while the shared Button API
 * models omitted attributes as `undefined`. Remove null entries at the
 * component boundary so action props retain their behavior and satisfy the
 * stricter primitive contract.
 */
export function normalizeButtonProps(props: object): ButtonProps {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (value !== null) normalized[key] = value;
  }

  return normalized as ButtonProps;
}
