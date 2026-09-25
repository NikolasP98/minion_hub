/**
 * The value list previewed when a colour-source option is hovered/focused in
 * `ColorSourcePicker` (owner directive 2026-09-25: "render a tooltip with the
 * available values (with colors) as a preview"). Pure and renderer-agnostic —
 * the picker only renders dots and names.
 *
 * `status` is the one source with no persisted colour of its own, so it keeps
 * the FIXED semantic tone ramp, the same hue the box/badge/chip already paint
 * (governance severity ramp). Every other source carries real domain colour
 * data; a row whose colour is unset still LISTS (with the calm neutral border)
 * rather than vanishing — the point of the preview is "what values exist".
 */
import type { ColorSource } from './booking-color';

export interface PreviewValue {
  name: string;
  /** A CSS colour: a raw domain hex, or a semantic token for the status ramp. */
  color: string;
}

/** No persisted colour → calm neutral, never `--color-accent` (an action colour). */
const NO_COLOR = 'var(--color-border-strong)';

/** The booking-status ramp, in the order the statuses read as a lifecycle. */
export const STATUS_PREVIEW: ReadonlyArray<readonly [string, string]> = [
  ['pending', 'var(--color-warning-border)'],
  ['accepted', 'var(--color-info-border)'],
  ['completed', 'var(--color-success-border)'],
  ['cancelled', NO_COLOR],
  ['rejected', 'var(--color-danger-border)'],
  ['no_show', 'var(--color-danger-border)'],
];

export interface PreviewData {
  /** The calendar's own `statusLabel` — the ramp shares its i18n names. */
  statusLabel: (status: string) => string;
  kinds?: ReadonlyArray<{ name?: string | null; color?: string | null }>;
  resources?: ReadonlyArray<{ name?: string | null; color?: string | null }>;
  eventTypes?: ReadonlyArray<{ title?: string | null; color?: string | null }>;
  tags?: ReadonlyArray<{ name?: string | null; color?: string | null }>;
  categories?: ReadonlyArray<{ name?: string | null; color?: string | null }>;
}

/** Nameless rows are dropped — a dot with no label previews nothing. */
function rows(
  list: ReadonlyArray<{ name?: string | null; color?: string | null }> | undefined,
): PreviewValue[] {
  return (list ?? [])
    .map((row) => ({ name: row.name?.trim() ?? '', color: row.color ?? NO_COLOR }))
    .filter((v) => v.name.length > 0);
}

/** Every value the `source` column can paint, in the order the user sees it. */
export function previewValues(source: ColorSource, data: PreviewData): PreviewValue[] {
  switch (source) {
    case 'status':
      return STATUS_PREVIEW.map(([status, color]) => ({ name: data.statusLabel(status), color }));
    case 'kind':
      return rows(data.kinds);
    case 'staff':
      return rows(data.resources);
    case 'service':
      return rows(data.eventTypes?.map((e) => ({ name: e.title, color: e.color })));
    case 'tags':
      return rows(data.tags);
    case 'category':
      return rows(data.categories);
    case 'none':
      return [];
  }
}

/** Tooltips stay readable: show the first `cap` values and count the rest. */
export const PREVIEW_CAP = 8;

export function capPreview(
  values: PreviewValue[],
  cap = PREVIEW_CAP,
): { shown: PreviewValue[]; more: number } {
  return { shown: values.slice(0, cap), more: Math.max(0, values.length - cap) };
}
