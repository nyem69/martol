<script lang="ts">
	import { X } from '@lucide/svelte';

	let {
		open,
		title = 'Confirm',
		message,
		confirmLabel = 'Delete',
		cancelLabel = 'Cancel',
		variant = 'danger',
		onConfirm,
		onCancel
	}: {
		open: boolean;
		title?: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'danger' | 'warning' | 'default';
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	let confirmBtn = $state<HTMLButtonElement | undefined>();

	$effect(() => {
		if (open) {
			// Focus cancel button on open for safety
			requestAnimationFrame(() => confirmBtn?.focus());
		}
	});

	function onKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') onCancel();
	}

	const accentVar = $derived(
		variant === 'danger' ? 'var(--danger)' : variant === 'warning' ? 'var(--warning, #f59e0b)' : 'var(--accent)'
	);
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: rgba(0, 0, 0, 0.7);"
		role="dialog"
		aria-modal="true"
		aria-label={title}
	>
		<button
			class="absolute inset-0 cursor-default border-none bg-transparent"
			onclick={onCancel}
			aria-label="Close"
			tabindex="-1"
		></button>

		<div
			class="relative z-10 w-full max-w-sm rounded-lg border"
			style="background: var(--bg-elevated); border-color: var(--border);"
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b px-4 py-3" style="border-color: var(--border);">
				<h3 class="text-sm font-semibold" style="color: var(--text); font-family: var(--font-mono);">
					{title}
				</h3>
				<button
					class="rounded p-0.5 transition-opacity hover:opacity-70"
					style="color: var(--text-muted);"
					onclick={onCancel}
					aria-label="Close"
				>
					<X size={14} />
				</button>
			</div>

			<!-- Body -->
			<div class="px-4 py-4">
				<p class="text-xs leading-relaxed" style="color: var(--text-muted); font-family: var(--font-mono);">
					{message}
				</p>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-end gap-2 border-t px-4 py-3" style="border-color: var(--border);">
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
					style="color: var(--text-muted); border: 1px solid var(--border); font-family: var(--font-mono);"
					onclick={onCancel}
				>
					{cancelLabel}
				</button>
				<button
					bind:this={confirmBtn}
					class="rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
					style="background: {accentVar}; color: var(--bg); font-family: var(--font-mono);"
					onclick={onConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
