/**
 * Sanctioned lucide `size={}` values. These mirror the `--icon-size-*` tokens
 * (xs 12 / sm 14 / md 16 / lg 20) in the @minion-stack/design-tokens contract
 * and are THE only sanctioned icon sizes — use `size={iconSizes.md}` etc.,
 * never a bare numeric literal (lint rule `raw-icon-size`).
 */
export const iconSizes = { xs: 12, sm: 14, md: 16, lg: 20 } as const;

export type IconSize = keyof typeof iconSizes;
