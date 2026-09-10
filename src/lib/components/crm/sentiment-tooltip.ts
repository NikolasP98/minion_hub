function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** ECharts consumes an HTML string rather than Svelte markup. Keep display text escaped. */
export function formatSentimentTooltip(
  dateLabel: string,
  score: number,
  sampleLabel: string,
): string {
  const scoreLabel = `${score > 0 ? '+' : ''}${score.toFixed(2)}`;
  const color = score >= 0 ? 'var(--color-success)' : 'var(--color-destructive)';
  return `<div style="font-weight:600">${escapeText(dateLabel)}</div>
<div style="color:${color};font-weight:700;font-variant-numeric:tabular-nums">${scoreLabel}</div>
<div style="opacity:0.7;font-size:var(--font-size-body)">${escapeText(sampleLabel)}</div>`;
}
