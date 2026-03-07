<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { X, ImagePlus } from '@lucide/svelte';
	import { trapFocus } from '$lib/utils/focus-trap';

	let { onClose, wasCanceled = false }: { onClose: () => void; wasCanceled?: boolean } = $props();
	let dialogEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		if (dialogEl) return trapFocus(dialogEl);
	});

	let status = $state<'idle' | 'loading' | 'error'>('idle');
	let errorMsg = $state('');

	async function handleSubscribe() {
		if (status === 'loading') return;
		status = 'loading';
		try {
			const res = await fetch('/api/checkout', { method: 'POST' });
			if (!res.ok) {
				let msg = 'Checkout failed';
				try { const d = (await res.json()) as { message?: string }; msg = d?.message || msg; } catch {}
				throw new Error(msg);
			}
			const { url } = (await res.json()) as { url?: string };
			// External redirect to Stripe checkout — goto() only handles in-app routes
			if (url) window.location.href = url;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Something went wrong';
			status = 'error';
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center p-4"
	style="background: rgba(0, 0, 0, 0.85);"
	role="dialog"
	aria-modal="true"
	aria-label={m.upgrade_title()}
>
	<button
		class="absolute inset-0 cursor-default border-none bg-transparent"
		onclick={onClose}
		aria-label={m.upgrade_close()}
		tabindex="-1"
	></button>

	<div
		bind:this={dialogEl}
		class="relative z-10 w-full max-w-sm rounded-lg p-6"
		style="background: var(--bg-surface); border: 1px solid var(--border);"
	>
		<button
			class="absolute top-3 right-3 cursor-pointer rounded-full p-1.5 transition-opacity hover:opacity-70"
			style="background: var(--bg-elevated); color: var(--text);"
			onclick={onClose}
			aria-label={m.upgrade_close()}
		>
			<X size={16} />
		</button>

		<div class="mb-4 flex items-center gap-3">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-lg"
				style="background: var(--bg-elevated); color: var(--accent);"
			>
				<ImagePlus size={20} />
			</div>
			<h2 class="text-base font-semibold" style="color: var(--text);">
				{wasCanceled ? m.upgrade_expired_title() : m.upgrade_title()}
			</h2>
		</div>

		<p class="mb-5 text-sm leading-relaxed" style="color: var(--text-muted);">
			{wasCanceled ? m.upgrade_expired_description() : m.upgrade_description()}
		</p>

		{#if status === 'error'}
			<p class="mb-3 text-xs" style="color: var(--danger);">
				{errorMsg}
			</p>
		{/if}

		<button
			class="w-full rounded px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
			style="background: var(--accent); color: var(--bg);"
			disabled={status === 'loading'}
			onclick={handleSubscribe}
			data-testid="upgrade-subscribe"
		>
			{#if status === 'loading'}
				{m.upgrade_loading()}
			{:else}
				{m.upgrade_button()}
			{/if}
		</button>

		<p class="mt-3 text-center text-[11px]" style="color: var(--text-muted);">
			{m.upgrade_cancel_anytime()}
		</p>
	</div>
</div>
