<script lang="ts">
  import { Button, Card, Input, Badge } from '@minion-stack/ui';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';
  import Chart from '$lib/components/charts/Chart.svelte';
  import Appearance from '../../../src/routes/(app)/settings/appearance/+page.svelte';
  import { theme, applyTheme } from '$lib/state/ui/theme.svelte';
  import type { EChartsOption } from 'echarts';

  let open = $state(false);
  let chartOptions = $state<EChartsOption>({});
  $effect(() => {
    applyTheme(theme.preset, theme.accent.value);
    const style = getComputedStyle(document.documentElement);
    const color = (token: string) => style.getPropertyValue(token).trim();
    chartOptions = {
      color: [color('--color-cyan'), color('--color-purple')],
      xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], axisLabel: { color: color('--color-text-tertiary') }, axisLine: { lineStyle: { color: color('--color-border-default') } } },
      yAxis: { type: 'value', axisLabel: { color: color('--color-text-tertiary') }, splitLine: { lineStyle: { color: color('--color-border-subtle') } } },
      series: [
        { name: 'Consultations', type: 'line', smooth: true, data: [18, 27, 22, 38, 29, 34, 42] },
        { name: 'Follow-ups', type: 'line', smooth: true, data: [8, 12, 16, 10, 22, 17, 24] },
      ],
    };
  });
  const visits = [
    { time: '09:00', name: 'Morgan Lee', kind: 'Consultation', status: 'success', label: 'Confirmed' },
    { time: '09:30', name: 'Alex Rivera', kind: 'Follow-up', status: 'info', label: 'Arrived' },
    { time: '10:00', name: 'Sam Parker', kind: 'Consultation', status: 'warning', label: 'Pending' },
    { time: '10:30', name: 'Taylor Chen', kind: 'Follow-up', status: 'error', label: 'Cancelled' },
  ] as const;
</script>

<div class="clinic-fixture">
  <header class="preview-tools">
    <div><p class="t-label text-muted">MINION · COMPONENT VERIFICATION</p><h1 class="t-heading">Clinic theme</h1></div>
    <div class="preview-actions">
      <Button size="touch" variant={theme.presetId === 'clinic-light' ? 'primary' : 'secondary'} aria-pressed={theme.presetId === 'clinic-light'} onclick={() => theme.setPreset('clinic-light')}>Clinic Light</Button>
      <Button size="touch" variant={theme.presetId === 'clinic-dark' ? 'primary' : 'secondary'} aria-pressed={theme.presetId === 'clinic-dark'} onclick={() => theme.setPreset('clinic-dark')}>Clinic Dark</Button>
      <Button size="touch" variant="outline" onclick={() => open = true}>Open dialog</Button>
    </div>
  </header>
  <div class="preview-shell">
    <aside class="preview-nav" aria-label="Preview navigation">
      <p class="t-heading">Minion<span class="brand-mark">✦</span></p>
      <p class="t-caption text-muted">Clinic workspace</p>
      <div class="nav-links">
        <Button variant="secondary" size="touch">Overview</Button>
        <Button variant="ghost" size="touch">Appointments</Button>
        <Button variant="ghost" size="touch">Contacts</Button>
        <Button variant="ghost" size="touch">Reports</Button>
      </div>
      <p class="t-caption text-muted">Synthetic preview · production components</p>
    </aside>
    <main class="preview-main">
      <div class="preview-heading"><div><p class="t-caption text-muted">Tuesday, 3 November</p><h2 class="t-display">A clear view of your day.</h2></div><Button variant="primary" size="touch" onclick={() => open = true}>New appointment</Button></div>
      <div class="metrics">
        {#each [['Appointments', '24', '8 remaining today'], ['Consultations', '16', '4 more than yesterday'], ['Follow-ups', '08', 'Care that stays connected']] as metric}
          <Card><p class="t-label text-muted">{metric[0]}</p><p class="t-display metric-value">{metric[1]}</p><p class="t-caption text-muted">{metric[2]}</p></Card>
        {/each}
      </div>
      <div class="preview-columns">
        <Card><h3 class="t-title">Activity this week</h3><p class="t-caption text-muted">Consultations and follow-ups</p><Chart options={chartOptions} height="260px" ariaLabel="Weekly visits" /></Card>
        <Card><h3 class="t-title">Today’s appointments</h3><div class="visit-list">{#each visits as visit}<div class="visit"><span class="t-mono text-muted">{visit.time}</span><div><p class="t-body">{visit.name}</p><p class="t-caption text-muted">{visit.kind}</p></div><Badge variant="semantic" value={visit.status}>{visit.label}</Badge></div>{/each}</div></Card>
      </div>
      <div class="preview-columns">
        <Card><h3 class="t-title">Form states</h3><div class="form-fields"><Input label="Appointment note" placeholder="Add a short note" size="touch" /><Input label="Contact email" value="alex" error="Enter a complete email address." size="touch" /><Input label="Disabled field" value="Read only" disabled size="touch" /></div></Card>
        <Card><h3 class="t-title">Every semantic role</h3><div class="role-list"><Badge variant="semantic" value="success">Confirmed</Badge><Badge variant="semantic" value="warning">Pending</Badge><Badge variant="semantic" value="error">Cancelled</Badge><Badge variant="semantic" value="info">Arrived</Badge></div><div class="swatches" aria-label="Categorical chart palette">{#each ['purple', 'pink', 'cyan', 'emerald', 'neutral'] as role}<div class="swatch" style:background="var(--color-{role})" aria-label={role}></div>{/each}</div><p class="t-body">Primary text</p><p class="t-caption text-muted">Secondary text</p><p class="tertiary-copy t-caption">Tertiary text remains readable.</p><div class="preview-actions"><Button variant="outline">Secondary</Button><Button variant="danger">Delete</Button><Button disabled>Disabled</Button></div></Card>
      </div>
    </main>
  </div>
  <details class="appearance-proof"><summary class="t-heading">Actual Hub appearance settings</summary><Appearance /></details>
</div>

<Dialog bind:open title="New appointment" size="sm">
  <Input label="Name" value="Morgan Lee" size="touch" />
  <p class="t-body">This dialog uses Hub’s production overlay, focus trap, and theme tokens.</p>
  {#snippet footer()}<Button variant="outline" size="touch" onclick={() => open = false}>Cancel</Button><Button variant="primary" size="touch" onclick={() => open = false}>Confirm</Button>{/snippet}
</Dialog>
