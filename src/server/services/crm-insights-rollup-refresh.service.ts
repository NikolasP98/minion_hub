import { refreshSentimentRollup } from './crm-sentiment-rollup.service';
import { refreshWordFrequencyRollup } from './crm-word-frequency-rollup.service';

export async function refreshCrmInsightsRollups(days: number) {
  const [wordRows, sentimentRows] = await Promise.all([
    refreshWordFrequencyRollup(days),
    refreshSentimentRollup(days),
  ]);
  return { ok: true as const, days, wordRows, sentimentRows };
}
