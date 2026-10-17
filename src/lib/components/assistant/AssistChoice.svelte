<script lang="ts">
  /**
   * Intent-choice buttons the assistant asks through `ui.choice`, rendered
   * INSIDE the assistant bubble that asked (MarkdownMessage). Picking one sends
   * the button's label as the user's next turn — natural text, never a token —
   * through the surface's own send path. One-shot per message: the pick fills
   * the card and the alternatives collapse away (AiApproval).
   */
  import { AiApproval } from '$lib/components/ai';
  import type { ChoiceOption } from '$lib/assistant/guide.svelte';

  interface Props {
    question: string;
    options: ChoiceOption[];
    onPick?: (text: string) => void;
  }
  const { question, options, onPick }: Props = $props();
  const items = $derived(options.map((o) => ({ id: o.label, label: o.label })));
</script>

<AiApproval {question} options={items} onDecide={onPick ? (o) => onPick(o.label) : undefined} />
