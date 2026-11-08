<script lang="ts">
  let { data }: { data: Record<string, unknown> } = $props();
</script>

<h1 id="peek-authority-record" data-record-title>{data.title}</h1>
<p>{data.secret}</p>
