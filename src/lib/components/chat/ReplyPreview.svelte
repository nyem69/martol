<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { X } from '@lucide/svelte';

	let {
		senderName,
		body,
		onCancel
	}: {
		senderName: string;
		body: string;
		onCancel: () => void;
	} = $props();

	// Truncate reply preview to first line, max 120 chars
	const preview = $derived(() => {
		const firstLine = body.split('\n')[0];
		return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
	});
</script>

<div
	class="flex items-center gap-2 rounded-t-lg px-3 py-1.5"
	style="background: var(--bg-elevated); border-bottom: 2px solid var(--accent);"
>
	<div class="min-w-0 flex-1">
		<span class="text-xs font-medium" style="color: var(--accent);">
			{m.chat_reply_to({ name: senderName })}
		</span>
		<p class="truncate text-xs" style="color: var(--text-muted);">
			{preview()}
		</p>
	</div>
	<button
		class="shrink-0 rounded p-0.5 transition-opacity hover:opacity-70"
		style="color: var(--text-muted);"
		onclick={onCancel}
		aria-label={m.chat_cancel_reply()}
	>
		<X size={14} />
	</button>
</div>
