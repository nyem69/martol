<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { X } from '@lucide/svelte';

	let {
		src,
		alt = '',
		onClose
	}: {
		src: string;
		alt?: string;
		onClose: () => void;
	} = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_interactive_supports_focus a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center p-4"
	style="background: rgba(0, 0, 0, 0.85);"
	onclick={onClose}
	role="dialog"
	aria-modal="true"
	aria-label={alt || m.chat_image_preview()}
	tabindex="-1"
>
	<button
		class="absolute top-4 right-4 rounded-full p-2 transition-opacity hover:opacity-70"
		style="background: var(--bg-elevated); color: var(--text);"
		onclick={onClose}
		aria-label={m.chat_close()}
	>
		<X size={20} />
	</button>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
	<img
		{src}
		{alt}
		class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
		onclick={(e) => e.stopPropagation()}
	/>
</div>
