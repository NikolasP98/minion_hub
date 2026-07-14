# Hub composition foundations

Import the Phase 3 components from `$lib/components/ui/foundations`. They are
additive until each domain migration removes its superseded local recipe.

## Composition contract

```svelte
<AppViewport decoration={theme.decoration ?? 'default'}>
  <PrimaryNav />
  <SectionShell>
    {#snippet navigation()}<SectionNav items={navItems} ariaLabel={sectionLabel} />{/snippet}
    <PageShell archetype="collection" scroll="page" labelledBy="agents-title">
      <PageHeader titleId="agents-title" title={title} {primaryActions} {overflowActions} />
      <PageBody><AgentCollection /></PageBody>
    </PageShell>
  </SectionShell>
</AppViewport>
```

- `AppViewport` owns dynamic viewport height and safe areas, never document scroll.
- `PageShell scroll="page"` is the primary scroll owner for dashboards, collections,
  records, and forms.
- `PageShell scroll="region"` remains fixed while exactly one `PageBody` or domain
  region opts into `scroll="region"`.
- Canvas, terminal, and editor routes use `scroll="none"`; their named internal
  region owns panning or scrolling.
- `PageHeader` accepts legacy `actions`, but migrated screens classify actions as
  `primaryActions`, `secondaryActions`, or `overflowActions`. When an overflow
  trigger exists, compact screens replace the secondary cluster with that trigger.
- `SectionNav` uses an attached rail at wide widths and a labelled horizontal strip
  below 1280px. A disabled destination renders without `href`.

## Fields

`FormField` owns the label, helper/error geometry, unique IDs, and all ARIA links.
The control receives the attributes it must spread:

```svelte
{#snippet emailControl(control)}
  <input {...control} bind:value={email} type="email" />
{/snippet}

<FormField
  label={m.account_email()}
  helper={m.account_emailHelp()}
  error={emailError}
  required
  children={emailControl}
/>
```

Use `FormFieldset` for radio/checkbox groups and `FieldGroup` only for arranging
already-labelled controls. Do not generate IDs in a component-instance counter.

## Async states

`AsyncBoundary` distinguishes `loading`, `ready`, `empty`, `error`, `forbidden`,
and `unavailable`. Callers supply localized, domain-specific empty and unavailable
copy. Retry belongs on recoverable error/unavailable states; permission is never
presented as empty data.

## Dialogs and layers

- `Dialog` uses the browser top layer, inert background, focus containment, focus
  return, and a reference-counted body scroll lock. A title or `labelledBy` is
  mandatory.
- `ConfirmDialog` keeps itself open when an async confirmation rejects. Supply a
  localized `failureMessage`; destructive confirmations use `tone="danger"`.
- `Sheet` is the same dialog contract with left, right, or bottom presentation.
- `Portal` moves only its display-contents wrapper. `Layer` is the sole numeric
  stacking authority; feature components select a named tier.

## Draggable windows

`DraggableWindow` floats only at `>=1280px`. Compact/medium viewports deliberately
transform it to a full-screen task surface or bottom sheet. The title bar supports
`Alt+Arrow` move and `Alt+Shift+Arrow` resize; `Ctrl` reduces the step. Supply
localized keyboard instructions and, when resizable, a localized resize label.

`variant="crt"`, `voxelized`, `canvas`, and `terminal` are stable hooks. Themes may
decorate those hooks but must not alter focus, geometry, labels, or responsive
transformation.

## Migration rule

A migrated route deletes its local modal, header, nav, layer, field, async, and
scroll recipes. It must not wrap the old recipe in a new shell. The route declares
one archetype, one primary scroll owner, action priorities, all async states, and a
named expressive variant where applicable.
