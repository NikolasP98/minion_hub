<script lang="ts">
	import ChatBlocks from '$lib/chat/ChatBlocks.svelte';
	import type { ChatMessage } from '$lib/types/chat';
	import type { ToolResult } from '$lib/chat/blocks';

	interface Props {
		message: ChatMessage;
		/** tool_use_id → result, collected across the whole thread by the parent. */
		toolResults?: Record<string, ToolResult>;
		/** True while this turn is still streaming (affects tool/"thinking" labels). */
		streaming?: boolean;
		/**
		 * When set, render THIS text as the answer instead of the message's own
		 * text blocks — used during streaming to show the smoothed (typewriter)
		 * reveal while reasoning/tool meta still come from `message`.
		 */
		textOverride?: string;
	}

	const props: Props = $props();
</script>

<ChatBlocks {...props} />
