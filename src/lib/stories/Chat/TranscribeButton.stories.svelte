<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import TranscribeButton from '$lib/components/my-agent/TranscribeButton.svelte';

  // Clicking the mic starts the browser's Web Speech API (or shows "not supported").
  const { Story } = defineMeta({
    title: 'Chat/TranscribeButton',
    component: TranscribeButton,
    tags: ['autodocs'],
    argTypes: { compact: { control: 'boolean' }, allowTab: { control: 'boolean' } },
    args: { onfinal: fn(), oninterim: fn(), onpolish: fn(), ondiscard: fn(), hasPending: () => false, detectedLang: () => null },
  });
</script>

<Story name="Default with options caret" />
<Story name="Pending transcript polish discard in menu" args={{ hasPending: () => true }} />
<Story name="No audio source picker" args={{ allowTab: false }} />
<Story name="Detected language Spanish" args={{ detectedLang: () => 'es' }} />
<Story name="Compact icon only" args={{ compact: true }} />
<Story name="Compact pending" args={{ compact: true, hasPending: () => true }} />
