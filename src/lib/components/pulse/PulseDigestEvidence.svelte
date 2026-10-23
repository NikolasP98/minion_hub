<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  let { payload }: { payload: Record<string, unknown> } = $props();
  type Evidence = {
    claim: string;
    relevance: string;
    nextStep: string;
    citations: { url: string; package: string; version: string }[];
  };
  function evidence(value: unknown): Evidence | null {
    if (!value || typeof value !== 'object') return null;
    const d = value as Record<string, unknown>;
    if (
      typeof d.claim !== 'string' ||
      typeof d.relevance !== 'string' ||
      typeof d.nextStep !== 'string' ||
      !Array.isArray(d.citations) ||
      d.citations.length > 20
    )
      return null;
    const citations: Evidence['citations'] = [];
    for (const item of d.citations) {
      if (!item || typeof item !== 'object') return null;
      const c = item as Record<string, unknown>;
      if (
        typeof c.url !== 'string' ||
        typeof c.package !== 'string' ||
        typeof c.version !== 'string'
      )
        return null;
      try {
        const url = new URL(c.url);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'github.com' ||
          url.username ||
          url.password ||
          url.port
        )
          return null;
      } catch {
        return null;
      }
      citations.push({ url: c.url, package: c.package, version: c.version });
    }
    return { claim: d.claim, relevance: d.relevance, nextStep: d.nextStep, citations };
  }
  const digest = $derived(evidence(payload.digest));
</script>

{#if digest}
  <div class="evidence">
    <p class="t-body">{digest.claim}</p>
    <p class="t-caption">{digest.relevance}</p>
    <p class="t-body"><strong>{m.pulse_digestNextStep()}</strong> {digest.nextStep}</p>
    <ul aria-label={m.pulse_digestEvidence()}>
      {#each digest.citations as c, i (`${c.url}:${i}`)}<li>
          <a href={c.url} target="_blank" rel="noopener noreferrer" class="t-caption"
            >{c.package} · {c.version}</a
          >
        </li>{/each}
    </ul>
  </div>
{/if}

<style>
  .evidence {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    overflow-wrap: anywhere;
  }
  ul {
    margin: 0;
    padding-inline-start: var(--space-4);
  }
  a {
    color: var(--color-text-primary);
    text-decoration: underline;
  }
</style>
