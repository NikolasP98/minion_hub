<script lang="ts">
  import CrmSentimentTrend from '$lib/components/crm/CrmSentimentTrend.svelte';

  const points = [
    { day: '2026-08-01', avg: 0.42, n: 5 },
    { day: '2026-08-02', avg: -0.1, n: 3 },
    { day: '2026-08-03', avg: 0.68, n: 9 },
  ];
</script>

<main>
  <h1>Chart accessibility fixture</h1>
  <div id="chart-region">
    <CrmSentimentTrend {points} current={{ avg: 0.68, n: 9 }} granularity="day" />
  </div>
</main>
