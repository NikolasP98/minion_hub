import { z } from 'zod';

export const COLUMN_NUMBER_FORMAT_STYLES = ['auto', 'decimal', 'currency', 'percent'] as const;
export const COLUMN_CURRENCY_DISPLAYS = ['symbol', 'code'] as const;
export const COLUMN_PERCENT_SCALES = ['ratio', 'whole'] as const;
export const COLUMN_PRESENTATION_TONES = ['none', 'sign'] as const;
export const COLUMN_PRESENTATION_EMPHASIS = ['normal', 'muted'] as const;

export interface ColumnNumberFormat {
  style: (typeof COLUMN_NUMBER_FORMAT_STYLES)[number];
  decimals: number | null;
  currencyDisplay: (typeof COLUMN_CURRENCY_DISPLAYS)[number];
  percentScale: (typeof COLUMN_PERCENT_SCALES)[number];
}

export interface ColumnPresentation {
  version: 1;
  number: ColumnNumberFormat;
  tone: (typeof COLUMN_PRESENTATION_TONES)[number];
  secondary: null | { propertyId: string; format: ColumnNumberFormat };
}
export interface ColumnVariablePresentation {
  variableId: string;
  number: ColumnNumberFormat | null;
  tone: (typeof COLUMN_PRESENTATION_TONES)[number];
  emphasis: (typeof COLUMN_PRESENTATION_EMPHASIS)[number];
}
export interface ColumnPresentationV2 {
  version: 2;
  variables: ColumnVariablePresentation[];
}
export type AnyColumnPresentation = ColumnPresentation | ColumnPresentationV2;

export const columnNumberFormatSchema = z
  .object({
    style: z.enum(COLUMN_NUMBER_FORMAT_STYLES),
    decimals: z.number().int().min(0).max(6).nullable(),
    currencyDisplay: z.enum(COLUMN_CURRENCY_DISPLAYS),
    percentScale: z.enum(COLUMN_PERCENT_SCALES),
  })
  .strict();

export const columnPresentationSchema = z
  .object({
    version: z.literal(1),
    number: columnNumberFormatSchema,
    tone: z.enum(COLUMN_PRESENTATION_TONES),
    secondary: z
      .object({ propertyId: z.string().uuid(), format: columnNumberFormatSchema })
      .strict()
      .nullable(),
  })
  .strict();
export const columnVariablePresentationSchema = z
  .object({
    variableId: z.string().uuid(),
    number: columnNumberFormatSchema.nullable(),
    tone: z.enum(COLUMN_PRESENTATION_TONES),
    emphasis: z.enum(COLUMN_PRESENTATION_EMPHASIS),
  })
  .strict();
export const columnPresentationV2Schema = z
  .object({
    version: z.literal(2),
    variables: z.array(columnVariablePresentationSchema).max(12),
  })
  .strict();
export const anyColumnPresentationSchema = z.union([
  columnPresentationSchema,
  columnPresentationV2Schema,
]);

export function defaultVariablePresentation(
  variableId: string,
  primary: boolean,
): ColumnVariablePresentation {
  return {
    variableId,
    number: DEFAULT_COLUMN_NUMBER_FORMAT,
    tone: 'none',
    emphasis: primary ? 'normal' : 'muted',
  };
}

export const DEFAULT_COLUMN_NUMBER_FORMAT: ColumnNumberFormat = Object.freeze({
  style: 'auto',
  decimals: null,
  currencyDisplay: 'symbol',
  percentScale: 'whole',
});

export const DEFAULT_COLUMN_PRESENTATION: ColumnPresentation = Object.freeze({
  version: 1,
  number: DEFAULT_COLUMN_NUMBER_FORMAT,
  tone: 'none',
  secondary: null,
});
