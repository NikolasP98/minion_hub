// UI primitives barrel.
// Co-located shadcn-style. Import via `$lib/components/ui`.
// Button/Badge/Card/Input are the shared design-system primitives, re-exported
// from @minion-stack/ui (the canonical source) so hub + site stay in sync.
export { Button, Badge, Card, Input } from '@minion-stack/ui';
export { default as Spinner } from './Spinner.svelte';
export { default as Skeleton } from './Skeleton.svelte';
export { default as Combobox } from './Combobox.svelte';
export { default as Modal } from './Modal.svelte';
export { default as PageHeader } from './PageHeader.svelte';
export { default as Select } from './Select.svelte';
export { default as MultiSelectFilter } from './MultiSelectFilter.svelte';
export { default as Toggle } from './Toggle.svelte';
export { default as Tabs } from './Tabs.svelte';
export { default as EmptyState } from './EmptyState.svelte';
export { default as MathFormula } from './MathFormula.svelte';
export { default as SideNav } from './SideNav.svelte';
export { default as Tooltip } from './Tooltip.svelte';
export { default as Dropdown } from './Dropdown.svelte';
export { default as Popover } from './Popover.svelte';
export type {
  ButtonVariant,
  ButtonSize,
  CardElevation,
  CardPadding,
  InputSize,
} from '@minion-stack/ui';
export type { ModalSize } from './Modal.svelte';
export type { SelectSize, SelectOption, SelectValue } from './Select.svelte';
export type { MultiSelectOption } from './MultiSelectFilter.svelte';
export type { ToggleSize } from './Toggle.svelte';
export type { TabsSize, TabItem } from './Tabs.svelte';
export type { EmptyStateTone } from './EmptyState.svelte';
export type { SideNavItem, SideNavGroup } from './SideNav.svelte';
export type { TooltipPlacement } from './Tooltip.svelte';
export type { DropdownItem } from './Dropdown.svelte';
