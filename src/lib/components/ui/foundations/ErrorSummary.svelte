<script lang="ts" module>
  export interface FieldError {
    id: string;
    message: string;
  }
</script>

<script lang="ts">
  let { title, errors }: { title: string; errors: readonly FieldError[] } = $props();
  const uid = $props.id();
  function focusField(event: MouseEvent, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: 'nearest' });
  }
</script>

{#if errors.length}
  <section data-component="error-summary" role="alert" aria-labelledby={uid}>
    <h3 id={uid} class="t-label">{title}</h3>
    <ul>
      {#each errors as error (error.id)}
        <li>
          <a href={`#${error.id}`} onclick={(event) => focusField(event, error.id)}
            >{error.message}</a
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  section {
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--color-danger-surface);
    color: var(--color-danger-fg);
  }
  h3 {
    margin: 0;
  }
  ul {
    margin: var(--space-2) 0 0;
    padding-inline-start: var(--space-4);
  }
  a {
    color: inherit;
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
</style>
