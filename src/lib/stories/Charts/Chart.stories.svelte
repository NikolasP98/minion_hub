<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import Chart from '$lib/components/charts/Chart.svelte';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sales = [120, 200, 150, 80, 70, 110, 130, 180, 210, 160, 140, 190];
  const returns = [20, 35, 18, 12, 9, 22, 25, 30, 41, 28, 19, 33];
  const axis = { xAxis: { type: 'category', data: months }, yAxis: { type: 'value' } };

  const { Story } = defineMeta({
    title: 'Charts/Chart',
    component: Chart,
    tags: ['autodocs'],
    argTypes: { height: { control: 'text' } },
    args: { height: '260px', onItemClick: fn(), onLegendToggle: fn(), ariaLabel: 'Monthly sales' },
  });
</script>

<Story
  name="Line"
  args={{
    options: {
      ...axis,
      tooltip: { trigger: 'axis' },
      legend: { data: ['Sales', 'Returns'] },
      series: [
        { type: 'line', name: 'Sales', data: sales },
        { type: 'line', name: 'Returns', data: returns },
      ],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Bar"
  args={{
    options: {
      ...axis,
      tooltip: { trigger: 'axis' },
      series: [{ type: 'bar', name: 'Sales', data: sales }],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Horizontal bar"
  args={{
    options: {
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: ['Botox', 'Filler', 'Peel', 'Laser', 'Consult'] },
      series: [{ type: 'bar', name: 'Tickets', data: [412, 318, 190, 120, 77] }],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Area"
  args={{
    options: {
      ...axis,
      tooltip: { trigger: 'axis' },
      series: [{ type: 'line', name: 'Sales', data: sales, areaStyle: {}, smooth: true }],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Stacked area"
  args={{
    options: {
      ...axis,
      tooltip: { trigger: 'axis' },
      legend: {},
      series: [
        { type: 'line', name: 'Cash', stack: 'all', areaStyle: {}, data: sales },
        { type: 'line', name: 'Card', stack: 'all', areaStyle: {}, data: returns },
        { type: 'line', name: 'Transfer', stack: 'all', areaStyle: {}, data: sales.map((v) => v / 3) },
      ],
    },
    notMergeUpdate: false,
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Stacked bar"
  args={{
    options: {
      ...axis,
      tooltip: { trigger: 'axis' },
      legend: {},
      series: [
        { type: 'bar', name: 'Cash', stack: 'all', data: sales },
        { type: 'bar', name: 'Card', stack: 'all', data: returns },
      ],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Pie"
  args={{
    ariaLabel: 'Income by method',
    options: {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: '60%',
          data: [
            { name: 'Cash', value: 4200 },
            { name: 'Card', value: 3100 },
            { name: 'Transfer', value: 1800 },
            { name: 'Wallet', value: 600 },
          ],
        },
      ],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Donut"
  args={{
    ariaLabel: 'Income by method',
    options: {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          label: { show: false },
          data: [
            { name: 'Cash', value: 4200 },
            { name: 'Card', value: 3100 },
            { name: 'Transfer', value: 1800 },
          ],
        },
      ],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story name="Empty (no series)" args={{ options: { ...axis, series: [] } }}>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Empty data"
  args={{ options: { xAxis: { type: 'category', data: [] }, yAxis: { type: 'value' }, series: [{ type: 'line', data: [] }] } }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Single point"
  args={{
    options: {
      xAxis: { type: 'category', data: ['Today'] },
      yAxis: { type: 'value' },
      series: [{ type: 'line', name: 'Sales', data: [42] }],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Large values (1e9)"
  args={{
    options: {
      ...axis,
      yAxis: { type: 'value', axisLabel: { formatter: '{value} PEN' } },
      tooltip: { trigger: 'axis' },
      series: [{ type: 'bar', name: 'Revenue', data: sales.map((v) => v * 1e7) }],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Many series"
  args={{
    options: {
      ...axis,
      tooltip: { trigger: 'axis' },
      legend: { type: 'scroll' },
      series: Array.from({ length: 10 }, (_, s) => ({
        type: 'line',
        name: `Branch ${s + 1}`,
        data: sales.map((v, i) => Math.round(v * (0.4 + ((s * 7 + i * 3) % 10) / 10))),
      })),
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story
  name="Long labels"
  args={{
    options: {
      xAxis: {
        type: 'category',
        data: [
          'Consulta dermatológica integral de primera vez',
          'Tratamiento con toxina botulínica (3 zonas)',
          'Relleno de ácido hialurónico en labios',
          'Peeling químico de profundidad media',
          'Láser fraccionado para cicatrices de acné',
        ],
        axisLabel: { rotate: 30, width: 120, overflow: 'truncate' },
      },
      yAxis: { type: 'value' },
      grid: { bottom: 90 },
      series: [{ type: 'bar', name: 'Tickets', data: [112, 98, 65, 40, 22] }],
    },
  }}
>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<Story name="Tall" args={{ height: '480px', options: { ...axis, series: [{ type: 'line', data: sales }] } }}>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>

<!-- Responsive: ECharts resizes with its host; the accessible table alternative scrolls horizontally. -->
<Story name="Line · Phone" args={{ options: { ...axis, series: [{ type: 'line', data: sales }] } }} globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}<Chart {...args} />{/snippet}
</Story>
