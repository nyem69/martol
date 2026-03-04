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

	let closeBtn: HTMLButtonElement | undefined = $state();
	let prevFocus: HTMLElement | null = null;

	$effect(() => {
		prevFocus = document.activeElement as HTMLElement;
		closeBtn?.focus();
		return () => prevFocus?.focus();
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
		// Trap focus within modal
		if (e.key === 'Tab') {
			e.preventDefault();
			closeBtn?.focus();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
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
		aria-label={m.chat_close()}
		tabindex="-1"
	></button>

	<button
		bind:this={closeBtn}
		class="absolute top-4 right-4 z-10 cursor-pointer rounded-full p-2 transition-opacity hover:opacity-70"
		style="background: var(--bg-elevated); color: var(--text);"
		onclick={onClose}
		aria-label={m.chat_close()}
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
