<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AiSources from '$lib/components/ai/AiSources.svelte';

  const HOSTS = [
    'sunat.gob.pe',
    'developer.mozilla.org',
    'svelte.dev',
    'en.wikipedia.org',
    'docs.stripe.com',
    'gob.pe',
    'who.int',
  ];
  const source = (i, title) => ({
    url: `https://${HOSTS[i % HOSTS.length]}/articles/${i + 1}`,
    host: HOSTS[i % HOSTS.length],
    title: title ?? `Reference article ${i + 1}`,
    snippet: i % 2 ? `A short excerpt that the model relied on for claim ${i + 1}.` : undefined,
  });
  const sources = (n) => Array.from({ length: n }, (_, i) => source(i));

  const { Story } = defineMeta({
    title: 'AI/AiSources',
    component: AiSources,
    tags: ['autodocs'],
    args: { sources: sources(3) },
  });
</script>

<Story name="Three sources" />
<Story name="Zero sources" args={{ sources: [] }} />
<Story name="One source" args={{ sources: sources(1) }} />
<Story name="Twenty sources 17 overflow" args={{ sources: sources(20) }} />
<Story name="Custom label" args={{ label: 'Read 3 pages' }} />
<Story
  name="Long titles and URLs"
  args={{
    sources: [
      source(
        0,
        'Resolución de Superintendencia N.° 000123-2026/SUNAT que modifica el reglamento de comprobantes de pago electrónicos y establece disposiciones transitorias para contribuyentes del régimen MYPE',
      ),
      {
        url: 'https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver/ResizeObserver#examples_with_an_extremely_long_fragment_identifier_that_goes_on',
        host: 'developer.mozilla.org',
        title: 'ResizeObserver() constructor - Web APIs | MDN',
      },
      source(2, 'Untitled'),
    ],
  }}
/>

<Story name="Narrow host">
  {#snippet template(args)}<div class="w-56">
      <AiSources {...args} sources={sources(6)} />
    </div>{/snippet}
</Story>
