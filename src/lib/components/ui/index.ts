// UI primitives barrel.
// Co-located shadcn-style. Import via `$lib/components/ui`.
// Button/Badge/Card/Input are direct shared design-system exports. Select,
// Toggle, Spinner, and Skeleton remain thin Hub compatibility adapters over
// that same package until their legacy prop names are retired.
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
export { default as SegmentedControl } from './SegmentedControl.svelte';
export { default as EmptyState } from './EmptyState.svelte';
export { default as MathFormula } from './MathFormula.svelte';
export { default as SideNav } from './SideNav.svelte';
export { default as Tooltip } from './Tooltip.svelte';
export { default as Dropdown } from './Dropdown.svelte';
export { default as Popover } from './Popover.svelte';
export { default as DraggableDialog } from './DraggableDialog.svelte';
export { default as StatusDot } from './StatusDot.svelte';
export { default as ProgressBar } from './ProgressBar.svelte';
export { default as Chip } from './Chip.svelte';
export { default as Avatar } from './Avatar.svelte';
export { iconSizes, type IconSize } from './icon-sizes';
export type {
  ButtonVariant,
  ButtonSize,
  CardElevation,
  CardPadding,
  InputSize,
} from '@minion-stack/ui';
export type { ModalProps, ModalSize } from './Modal.svelte';
export type { SelectProps, SelectSize, SelectOption, SelectValue } from './Select.svelte';
export type { MultiSelectOption } from './MultiSelectFilter.svelte';
export type { ToggleProps, ToggleSize } from './Toggle.svelte';
export type { SpinnerProps, SpinnerSize } from './Spinner.svelte';
export type { SkeletonProps } from './Skeleton.svelte';
export type { TabsSize, TabItem } from './Tabs.svelte';
export type { EmptyStateTone } from './EmptyState.svelte';
export type { SideNavItem, SideNavGroup } from './SideNav.svelte';
export type { TooltipPlacement } from './Tooltip.svelte';
export type { DropdownItem } from './Dropdown.svelte';
export type { ProgressBarProps, ProgressBarSize, ProgressBarTone } from './ProgressBar.svelte';
export type { ChipStatus } from './Chip.svelte';
export type { AvatarSize } from './Avatar.svelte';
