import { z } from 'zod';

export const COLUMN_NUMBER_FORMAT_STYLES = ['auto', 'decimal', 'currency', 'percent'] as const;
export const COLUMN_CURRENCY_DISPLAYS = ['symbol', 'code'] as const;
export const COLUMN_PERCENT_SCALES = ['ratio', 'whole'] as const;
export const COLUMN_PRESENTATION_TONES = ['none', 'sign'] as const;

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
