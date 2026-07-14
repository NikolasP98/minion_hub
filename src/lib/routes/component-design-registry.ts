export interface ComponentVariantContract {
  /** Named string/number literal union in the component's generated or source declaration. */
  typeName: string;
  /** Optional declaration path when the component imports its variant type from a sibling. */
  sourcePath?: string;
  /** Values intentionally removed from a reused type (for example IconButton excludes `icon`). */
  exclude?: readonly string[];
}

export interface ComponentSourceContract {
  /** Exported symbol after the `#` in package paths. */
  exportName?: string;
  /** Metadata axis -> source union which must resolve to exactly the same values. */
  variantTypes?: Readonly<Record<string, ComponentVariantContract>>;
  /** Metadata axes backed by an inline prop union or boolean in the declaration. */
  variantProperties?: Readonly<Record<string, { propertyName: string }>>;
}

export interface ComponentDesignMeta {
  codeId: string;
  exportPath: string;
  variants: Readonly<Record<string, readonly string[]>>;
  states: readonly string[];
  tokenRoles: readonly string[];
  figmaComponentKey?: string;
  sourceContract?: ComponentSourceContract;
}

function component(
  codeId: string,
  exportPath: string,
  variants: ComponentDesignMeta['variants'],
  states: readonly string[],
  tokenRoles: readonly string[],
  sourceContract?: ComponentSourceContract,
): ComponentDesignMeta {
  return { codeId, exportPath, variants, states, tokenRoles, sourceContract };
}

/**
 * Code-owned names for the canonical primitive, composed and shell components.
 * Figma component keys are intentionally blank until the reviewed library is
 * created; the keys can then be added without renaming code or Figma variants.
 */
export const COMPONENT_DESIGN_REGISTRY = [
  component(
    'primitive.button',
    '@minion-stack/ui#Button',
    {
      variant: ['primary', 'secondary', 'ghost', 'danger', 'outline'],
      size: ['xs', 'sm', 'md', 'lg', 'touch', 'icon'],
      shape: ['default', 'icon'],
    },
    ['default', 'hover', 'focus-visible', 'pressed', 'disabled', 'loading'],
    ['color.action.*', 'space.control.*', 'radius.control', 'motion.interaction.*'],
    {
      exportName: 'Button',
      variantTypes: {
        variant: { typeName: 'ButtonVariant' },
        size: { typeName: 'ButtonSize' },
        shape: { typeName: 'ButtonShape' },
      },
    },
  ),
  component(
    'primitive.icon-button',
    '@minion-stack/ui#IconButton',
    {
      variant: ['primary', 'secondary', 'ghost', 'danger', 'outline'],
      size: ['xs', 'sm', 'md', 'lg', 'touch'],
    },
    ['default', 'hover', 'focus-visible', 'pressed', 'disabled', 'loading'],
    ['color.action.*', 'space.control.*', 'radius.control', 'motion.interaction.*'],
    {
      exportName: 'IconButton',
      variantTypes: {
        variant: { typeName: 'ButtonVariant' },
        size: { typeName: 'ButtonSize', exclude: ['icon'] },
      },
    },
  ),
  component(
    'primitive.badge',
    '@minion-stack/ui#Badge',
    {
      variant: ['status', 'semantic', 'neutral'],
      statusValue: ['running', 'thinking', 'idle', 'aborted'],
      semanticValue: ['success', 'error', 'warning', 'info', 'accent', 'brand'],
      size: ['sm', 'md'],
      dot: ['false', 'true'],
      pulse: ['false', 'true'],
    },
    ['default'],
    ['color.status.*', 'type.caption', 'radius.pill'],
    {
      exportName: 'Badge',
      variantTypes: {
        variant: { typeName: 'BadgeVariant' },
        statusValue: { typeName: 'StatusValue' },
        semanticValue: { typeName: 'SemanticValue' },
        size: { typeName: 'BadgeSize' },
      },
      variantProperties: {
        dot: { propertyName: 'dot' },
        pulse: { propertyName: 'pulse' },
      },
    },
  ),
  component(
    'primitive.card',
    '@minion-stack/ui#Card',
    {
      elevation: ['1', '2', '3', '4'],
      padding: ['none', 'sm', 'md', 'lg'],
      interactive: ['false', 'true'],
    },
    ['default', 'hover'],
    ['color.surface.*', 'color.border.*', 'radius.surface', 'shadow.surface.*'],
    {
      exportName: 'Card',
      variantTypes: {
        elevation: { typeName: 'CardElevation' },
        padding: { typeName: 'CardPadding' },
      },
      variantProperties: { interactive: { propertyName: 'interactive' } },
    },
  ),
  component(
    'primitive.input',
    '@minion-stack/ui#Input',
    { size: ['sm', 'md', 'lg', 'touch'] },
    ['empty', 'filled', 'focus-visible', 'invalid', 'disabled', 'readonly'],
    ['color.field.*', 'space.control.*', 'radius.control', 'type.body'],
    {
      exportName: 'Input',
      variantTypes: { size: { typeName: 'InputSize' } },
    },
  ),
  component(
    'primitive.textarea',
    '@minion-stack/ui#Textarea',
    { size: ['sm', 'md', 'lg'] },
    ['empty', 'filled', 'focus-visible', 'invalid', 'disabled', 'readonly'],
    ['color.field.*', 'space.control.*', 'radius.control', 'type.body'],
    {
      exportName: 'Textarea',
      variantTypes: { size: { typeName: 'TextareaSize' } },
    },
  ),
  component(
    'primitive.select',
    '@minion-stack/ui#Select',
    { size: ['sm', 'md', 'lg', 'touch'] },
    ['default', 'focus-visible', 'invalid', 'disabled'],
    ['color.field.*', 'space.control.*', 'radius.control', 'type.body'],
    {
      exportName: 'Select',
      variantTypes: { size: { typeName: 'SelectSize' } },
    },
  ),
  component(
    'primitive.checkbox',
    '@minion-stack/ui#Checkbox',
    {},
    ['unchecked', 'checked', 'indeterminate', 'focus-visible', 'invalid', 'disabled'],
    ['color.action.*', 'color.field.*', 'space.control.*'],
    { exportName: 'Checkbox' },
  ),
  component(
    'primitive.radio',
    '@minion-stack/ui#Radio',
    {},
    ['unchecked', 'checked', 'focus-visible', 'disabled'],
    ['color.action.*', 'color.field.*', 'space.control.*'],
    { exportName: 'Radio' },
  ),
  component(
    'primitive.toggle',
    '@minion-stack/ui#Toggle',
    { size: ['sm', 'md', 'touch'] },
    ['off', 'on', 'focus-visible', 'disabled'],
    ['color.action.*', 'color.border.*', 'radius.pill', 'motion.interaction.*'],
    {
      exportName: 'Toggle',
      variantTypes: { size: { typeName: 'ToggleSize' } },
    },
  ),
  component(
    'primitive.form-field',
    '@minion-stack/ui#FormField',
    {},
    ['default', 'required', 'invalid', 'disabled', 'help'],
    ['color.text.*', 'color.field.*', 'space.form.*', 'type.label'],
    { exportName: 'FormField' },
  ),
  component(
    'form.field',
    '$lib/components/ui/foundations/FormField.svelte',
    { orientation: ['stacked', 'inline'] },
    ['default', 'required', 'invalid', 'disabled', 'help'],
    ['color.text.*', 'color.field.*', 'space.form.*', 'type.label'],
    { variantTypes: { orientation: { typeName: 'FormFieldOrientation' } } },
  ),
  component(
    'form.field-group',
    '$lib/components/ui/foundations/FieldGroup.svelte',
    { direction: ['row', 'column'] },
    ['default'],
    ['space.form.*', 'layout.content.*'],
    { variantProperties: { direction: { propertyName: 'direction' } } },
  ),
  component(
    'form.fieldset',
    '$lib/components/ui/foundations/FormFieldset.svelte',
    {},
    ['default', 'disabled'],
    ['color.surface.*', 'color.border.*', 'space.form.*', 'radius.surface'],
  ),
  component(
    'form.select',
    '@minion-stack/ui#Select',
    { size: ['sm', 'md', 'lg', 'touch'] },
    ['default', 'focus-visible', 'invalid', 'disabled'],
    ['color.field.*', 'space.control.*', 'radius.control', 'layer.popover'],
    {
      exportName: 'Select',
      variantTypes: { size: { typeName: 'SelectSize' } },
    },
  ),
  component(
    'form.toggle',
    '@minion-stack/ui#Toggle',
    { size: ['sm', 'md', 'touch'] },
    ['off', 'on', 'focus-visible', 'disabled'],
    ['color.action.*', 'color.border.*', 'radius.pill', 'motion.interaction.*'],
    {
      exportName: 'Toggle',
      variantTypes: { size: { typeName: 'ToggleSize' } },
    },
  ),
  component(
    'navigation.tabs',
    '$lib/components/ui/Tabs.svelte',
    { size: ['sm', 'md'] },
    ['default', 'active', 'hover', 'focus-visible', 'disabled'],
    ['color.text.*', 'color.action.*', 'space.control.*', 'motion.interaction.*'],
    { variantTypes: { size: { typeName: 'TabsSize' } } },
  ),
  component(
    'feedback.status-dot',
    '$lib/components/ui/StatusDot.svelte',
    { state: ['active', 'attention', 'disabled'], expanded: ['false', 'true'] },
    ['collapsed', 'expanded'],
    ['color.status.*', 'motion.status.*'],
    {
      variantProperties: {
        state: { propertyName: 'state' },
        expanded: { propertyName: 'expanded' },
      },
    },
  ),
  component(
    'feedback.spinner',
    '@minion-stack/ui#Spinner',
    { size: ['xs', 'sm', 'md', 'lg'] },
    ['active'],
    ['color.action.*', 'motion.loading.*'],
    {
      exportName: 'Spinner',
      variantTypes: { size: { typeName: 'SpinnerSize' } },
    },
  ),
  component(
    'feedback.skeleton',
    '@minion-stack/ui#Skeleton',
    { shape: ['text', 'rect', 'circle'] },
    ['loading'],
    ['color.surface.*', 'radius.*', 'motion.loading.*'],
    {
      exportName: 'Skeleton',
      variantTypes: { shape: { typeName: 'SkeletonShape' } },
    },
  ),
  component(
    'feedback.empty-state',
    '$lib/components/ui/EmptyState.svelte',
    { tone: ['neutral', 'error'], compact: ['false', 'true'] },
    ['default', 'with-action'],
    ['color.text.*', 'color.status.*', 'space.section.*', 'type.*'],
    {
      variantTypes: { tone: { typeName: 'EmptyStateTone' } },
      variantProperties: { compact: { propertyName: 'compact' } },
    },
  ),
  component(
    'feedback.async-boundary',
    '$lib/components/ui/foundations/AsyncBoundary.svelte',
    {
      state: ['loading', 'ready', 'empty', 'error', 'forbidden', 'unavailable'],
      compact: ['false', 'true'],
    },
    ['loading', 'ready', 'empty', 'error', 'forbidden', 'unavailable'],
    ['color.surface.*', 'color.status.*', 'space.section.*'],
    {
      variantTypes: { state: { typeName: 'AsyncBoundaryState' } },
      variantProperties: { compact: { propertyName: 'compact' } },
    },
  ),
  component(
    'overlay.dialog',
    '$lib/components/ui/foundations/Dialog.svelte',
    {
      size: ['sm', 'md', 'lg', 'xl'],
      presentation: ['dialog', 'sheet'],
      placement: ['left', 'right', 'bottom'],
      variant: ['default', 'crt', 'voxelized', 'canvas', 'terminal'],
    },
    ['closed', 'opening', 'open', 'closing'],
    ['color.overlay.*', 'color.surface.*', 'radius.overlay', 'shadow.overlay', 'layer.dialog'],
    {
      variantTypes: {
        size: { typeName: 'DialogSize' },
        presentation: { typeName: 'DialogPresentation' },
        placement: { typeName: 'SheetPlacement' },
        variant: { typeName: 'DialogVariant' },
      },
    },
  ),
  component(
    'overlay.confirm-dialog',
    '$lib/components/ui/foundations/ConfirmDialog.svelte',
    {
      tone: ['default', 'danger'],
      variant: ['default', 'crt', 'voxelized', 'canvas', 'terminal'],
    },
    ['closed', 'open', 'submitting', 'error'],
    ['color.overlay.*', 'color.action.*', 'radius.overlay', 'shadow.overlay', 'layer.dialog'],
    {
      variantTypes: {
        tone: { typeName: 'ConfirmDialogTone' },
        variant: {
          typeName: 'DialogVariant',
          sourcePath: '$lib/components/ui/foundations/Dialog.svelte',
        },
      },
    },
  ),
  component(
    'overlay.sheet',
    '$lib/components/ui/foundations/Sheet.svelte',
    {
      placement: ['left', 'right', 'bottom'],
      size: ['sm', 'md', 'lg', 'xl'],
      variant: ['default', 'crt', 'voxelized', 'canvas', 'terminal'],
    },
    ['closed', 'opening', 'open', 'closing'],
    ['color.overlay.*', 'color.surface.*', 'shadow.overlay', 'layer.sheet', 'motion.overlay.*'],
    {
      variantTypes: {
        placement: {
          typeName: 'SheetPlacement',
          sourcePath: '$lib/components/ui/foundations/Dialog.svelte',
        },
        size: {
          typeName: 'DialogSize',
          sourcePath: '$lib/components/ui/foundations/Dialog.svelte',
        },
        variant: {
          typeName: 'DialogVariant',
          sourcePath: '$lib/components/ui/foundations/Dialog.svelte',
        },
      },
    },
  ),
  component(
    'overlay.draggable-window',
    '$lib/components/ui/foundations/DraggableWindow.svelte',
    {
      variant: ['default', 'crt', 'voxelized', 'canvas', 'terminal'],
      compactPresentation: ['fullscreen', 'sheet'],
    },
    ['closed', 'open', 'dragging', 'resizing', 'maximized'],
    ['color.surface.*', 'color.border.*', 'radius.overlay', 'shadow.overlay', 'layer.window'],
    {
      variantTypes: {
        variant: { typeName: 'DraggableWindowVariant' },
        compactPresentation: { typeName: 'CompactWindowPresentation' },
      },
    },
  ),
  component(
    'overlay.popover',
    '$lib/components/ui/Popover.svelte',
    { placement: ['top', 'right', 'bottom', 'left'] },
    ['closed', 'open'],
    ['color.surface.*', 'color.border.*', 'radius.popover', 'shadow.popover', 'layer.popover'],
    { variantTypes: { placement: { typeName: 'Placement' } } },
  ),
  component(
    'overlay.dropdown',
    '$lib/components/ui/Dropdown.svelte',
    { placement: ['top', 'right', 'bottom', 'left'] },
    ['closed', 'open', 'item-hover', 'item-disabled'],
    ['color.surface.*', 'color.action.*', 'radius.popover', 'shadow.popover', 'layer.popover'],
    { variantTypes: { placement: { typeName: 'Placement' } } },
  ),
  component(
    'overlay.tooltip',
    '$lib/components/ui/Tooltip.svelte',
    { placement: ['top', 'right', 'bottom', 'left'] },
    ['hidden', 'visible'],
    ['color.inverse.*', 'type.caption', 'radius.tooltip', 'layer.tooltip'],
    { variantTypes: { placement: { typeName: 'TooltipPlacement' } } },
  ),
  component(
    'layout.app-viewport',
    '$lib/components/ui/foundations/AppViewport.svelte',
    { density: ['comfortable', 'compact'], decoration: ['default', 'crt', 'voxelized'] },
    ['compact', 'medium', 'wide'],
    ['color.canvas', 'layout.viewport.*', 'space.safe-area.*'],
    {
      variantTypes: {
        density: { typeName: 'AppDensity' },
        decoration: { typeName: 'AppDecoration' },
      },
    },
  ),
  component(
    'layout.section-shell',
    '$lib/components/ui/foundations/SectionShell.svelte',
    {
      mode: ['responsive', 'stacked', 'split'],
      variant: ['default', 'canvas', 'terminal'],
    },
    ['compact', 'medium', 'wide'],
    ['color.canvas', 'color.border.*', 'layout.section.*'],
    {
      variantTypes: { mode: { typeName: 'SectionShellMode' } },
      variantProperties: { variant: { propertyName: 'variant' } },
    },
  ),
  component(
    'navigation.section-nav',
    '$lib/components/ui/foundations/SectionNav.svelte',
    {},
    ['default', 'active', 'hover', 'focus-visible', 'disabled'],
    ['color.navigation.*', 'space.navigation.*', 'radius.control', 'layout.section-nav.*'],
  ),
  component(
    'layout.page-shell',
    '$lib/components/ui/foundations/PageShell.svelte',
    {
      archetype: [
        'dashboard',
        'collection',
        'record-detail',
        'form',
        'master-detail',
        'workspace',
        'canvas',
        'terminal',
        'public',
      ],
      scroll: ['page', 'region', 'none'],
      variant: ['default', 'crt', 'voxelized', 'canvas', 'terminal'],
    },
    ['compact', 'medium', 'wide'],
    ['color.canvas', 'layout.content.*', 'space.page.*'],
    {
      variantTypes: {
        archetype: { typeName: 'RouteArchetype' },
        scroll: { typeName: 'PageScrollMode' },
      },
      variantProperties: { variant: { propertyName: 'variant' } },
    },
  ),
  component(
    'layout.public-task-shell',
    '$lib/components/ui/foundations/PublicTaskShell.svelte',
    {
      size: ['narrow', 'medium', 'wide'],
      tone: ['default', 'success', 'warning', 'danger'],
    },
    ['default', 'success', 'warning', 'danger', 'compact', 'medium', 'wide'],
    [
      'color.canvas',
      'color.surface.*',
      'color.status.*',
      'layout.viewport.*',
      'space.safe-area.*',
      'shadow.overlay',
      'motion.entrance.*',
    ],
    {
      variantTypes: {
        size: { typeName: 'PublicTaskShellSize' },
        tone: { typeName: 'PublicTaskShellTone' },
      },
    },
  ),
  component(
    'layout.page-header',
    '$lib/components/ui/PageHeader.svelte',
    { sticky: ['false', 'true'] },
    ['default', 'with-subtitle', 'with-actions'],
    ['color.canvas', 'color.border.*', 'space.page.*', 'type.page-title', 'layer.sticky'],
    { variantProperties: { sticky: { propertyName: 'sticky' } } },
  ),
  component(
    'layout.page-body',
    '$lib/components/ui/foundations/PageBody.svelte',
    {
      width: ['full', 'content', 'reading'],
      padding: ['none', 'compact', 'default'],
      scroll: ['inherit', 'region', 'none'],
    },
    ['compact', 'medium', 'wide'],
    ['layout.content.*', 'space.page.*'],
    {
      variantTypes: {
        width: { typeName: 'PageBodyWidth' },
        padding: { typeName: 'PageBodyPadding' },
      },
      variantProperties: { scroll: { propertyName: 'scroll' } },
    },
  ),
  component(
    'navigation.primary',
    '$lib/components/layout/GNav.svelte',
    {},
    ['expanded', 'collapsed', 'mobile-open'],
    ['color.navigation.*', 'space.navigation.*', 'layout.primary-nav.*', 'layer.navigation'],
  ),
  component(
    'navigation.topbar',
    '$lib/components/layout/Topbar.svelte',
    {},
    ['default', 'menu-open', 'offline'],
    ['color.navigation.*', 'space.navigation.*', 'layout.topbar.*', 'layer.navigation'],
  ),
  component(
    'overlay.command-palette',
    '$lib/components/layout/CommandPalette.svelte',
    {},
    ['closed', 'open', 'searching', 'no-results'],
    ['color.overlay.*', 'color.surface.*', 'radius.overlay', 'shadow.overlay', 'layer.command'],
  ),
  component(
    'feedback.toaster',
    '$lib/components/layout/Toaster.svelte',
    {},
    ['empty', 'single', 'stacked'],
    ['color.status.*', 'radius.surface', 'shadow.overlay', 'layer.toast', 'motion.status.*'],
  ),
] as const satisfies readonly ComponentDesignMeta[];

export const COMPONENT_DESIGN_BY_ID = new Map(
  COMPONENT_DESIGN_REGISTRY.map((entry) => [entry.codeId, entry] as const),
);
