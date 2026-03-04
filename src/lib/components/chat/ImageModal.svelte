<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { X } from '@lucide/svelte';
	import { trapFocus } from '$lib/utils/focus-trap';

	let {
		src,
		alt = '',
		onClose
	}: {
		src: string;
		alt?: string;
		onClose: () => void;
	} = $props();

	let dialogEl: HTMLDivElement | undefined = $state();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	onMount(() => {
		if (dialogEl) return trapFocus(dialogEl);
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div
	bind:this={dialogEl}
	class="fixed inset-0 z-50 flex items-center justify-center p-4"
	style="background: rgba(0, 0, 0, 0.85);"
	role="dialog"
	aria-modal="true"
	aria-label={alt || m.chat_image_preview()}
>
	<!-- Backdrop click-to-close -->
	<button
		class="absolute inset-0 cursor-default border-none bg-transparent"
		onclick={onClose}
		aria-label={m.image_close()}
		tabindex="-1"
	></button>

	<button
		class="absolute top-4 right-4 z-10 cursor-pointer rounded-full p-2 transition-opacity hover:opacity-70"
		style="background: var(--bg-elevated); color: var(--text);"
		onclick={onClose}
		aria-label={m.image_close()}
	>
		<X size={20} />
	</button>
	<img
		{src}
		{alt}
		class="relative z-10 max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
		role="presentation"
	/>
</div>
