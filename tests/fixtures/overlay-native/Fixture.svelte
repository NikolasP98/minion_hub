<script lang="ts">
  import { onMount, tick } from 'svelte';
  import SecretEditModal from '$lib/components/settings/SecretEditModal.svelte';
  import ImageLightbox from '$lib/components/my-agent/ImageLightbox.svelte';
  let secretOpen = $state(false);
  let image = $state<string | null>(null);
  let saves = $state(0);
  let closes = $state(0);
  type SaveResult = { probeStatus: 'ok'; probeMessage: string };
  let resolveSave: ((value: SaveResult) => void) | undefined;
  let rejectSave: ((reason: Error) => void) | undefined;
  onMount(() => {
    const fixtureWindow = window as Window & {
      __overlayFixture?: { reopen: () => Promise<void>; succeed: () => void; fail: () => void };
    };
    fixtureWindow.__overlayFixture = {
      reopen: async () => {
        secretOpen = false;
        await tick();
        secretOpen = true;
        await tick();
      },
      succeed: () => resolveSave?.({ probeStatus: 'ok', probeMessage: 'Verified test response' }),
      fail: () => rejectSave?.(new Error('Fixture save failed')),
    };
    return () => {
      delete fixtureWindow.__overlayFixture;
    };
  });
  function save(_value: string): Promise<SaveResult> {
    saves += 1;
    return new Promise<SaveResult>((resolve, reject) => {
      resolveSave = resolve;
      rejectSave = reject;
    });
  }
</script>

<main>
  <h1>Overlay contract fixture</h1>
  <button id="open-secret" onclick={() => (secretOpen = true)}>Open secret</button>
  <button
    id="open-image"
    onclick={() =>
      (image =
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="400"%3E%3Crect width="600" height="400" fill="steelblue"/%3E%3C/svg%3E')}
    >Open image</button
  >
  <button id="background">Background action</button>
  <output id="fixture-state" data-saves={saves} data-closes={closes}
    >{saves} saves / {closes} closes</output
  >
</main>
<SecretEditModal
  open={secretOpen}
  secretKey="FIXTURE_KEY"
  secretLabel="Fixture credential"
  onSave={save}
  onClose={() => {
    secretOpen = false;
    closes += 1;
  }}
/>
<ImageLightbox
  src={image}
  alt="Blue test rectangle"
  onclose={() => {
    image = null;
    closes += 1;
  }}
/>
