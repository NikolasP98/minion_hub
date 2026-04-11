import { z } from 'zod';

export const ActionPlanSchema = z.object({
  goal: z.string(),
  steps: z.array(
    z.object({
      id: z.number(),
      action: z.string(),
      rationale: z.string().optional(),
      status: z.enum(['pending', 'active', 'done']).default('pending'),
    })
  ),
});

export const SearchResultSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string().optional(),
    })
  ),
});

export const CalendarSummarySchema = z.object({
  date: z.string(),
  events: z.array(
    z.object({
      time: z.string(),
      title: z.string(),
      location: z.string().optional(),
      notes: z.string().optional(),
    })
  ),
});

export type ActionPlan = z.infer<typeof ActionPlanSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type CalendarSummary = z.infer<typeof CalendarSummarySchema>;

export const SCHEMA_MAP = {
  action_plan: ActionPlanSchema,
  search_results: SearchResultSchema,
  calendar_summary: CalendarSummarySchema,
} as const;

export type SchemaType = keyof typeof SCHEMA_MAP;
