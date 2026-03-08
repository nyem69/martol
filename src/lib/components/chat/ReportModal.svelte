<script lang="ts">
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { X } from '@lucide/svelte';

	let {
		messageId,
		messageBody,
		onClose
	}: {
		messageId: number;
		messageBody: string;
		onClose: () => void;
	} = $props();

	type Reason = 'csam' | 'nsfw' | 'spam' | 'scam' | 'harassment' | 'other';

	let reason = $state<Reason | null>(null);
	let details = $state('');
	let status = $state<'idle' | 'submitting' | 'success' | 'error'>('idle');
	let closeBtn: HTMLButtonElement | undefined;
	let prevFocus: HTMLElement | null = null;
	let dialogEl: HTMLDivElement | undefined;

	$effect(() => {
		prevFocus = document.activeElement as HTMLElement;
		untrack(() => closeBtn?.focus());
		return () => prevFocus?.focus();
	});

	const truncatedBody = $derived(
		messageBody.length > 120 ? messageBody.slice(0, 120) + '...' : messageBody
	);

	const canSubmit = $derived(reason !== null && status === 'idle');

	const reasons: { value: Reason; label: () => string }[] = [
		{ value: 'csam', label: () => m.report_reason_csam() },
		{ value: 'nsfw', label: () => m.report_reason_nsfw() },
		{ value: 'spam', label: () => m.report_reason_spam() },
		{ value: 'scam', label: () => m.report_reason_scam() },
		{ value: 'harassment', label: () => m.report_reason_harassment() },
		{ value: 'other', label: () => m.report_reason_other() }
	];

	async function handleSubmit() {
		if (!reason || status === 'submitting') return;
		status = 'submitting';
		try {
			const res = await fetch('/api/reports', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messageId,
					reason,
					details: details.trim() || undefined
				})
			});
			if (!res.ok) throw new Error('Failed');
			status = 'success';
		} catch {
			status = 'error';
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
		if (e.key === 'Tab' && dialogEl) {
			const focusable = dialogEl.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center p-4"
	style="background: rgba(0, 0, 0, 0.85);"
	role="dialog"
	aria-modal="true"
	aria-label={m.report_title()}
>
	<!-- Backdrop click-to-close -->
	<button
		class="absolute inset-0 cursor-default border-none bg-transparent"
		onclick={onClose}
		aria-label={m.chat_close()}
		tabindex="-1"
		data-testid="report-backdrop"
	></button>

	<div
		bind:this={dialogEl}
		class="relative z-10 w-full max-w-md rounded-lg p-6"
		style="background: var(--bg-surface); border: 1px solid var(--border);"
	>
		<!-- Close button -->
		<button
			bind:this={closeBtn}
			class="absolute top-3 right-3 cursor-pointer rounded-full p-1.5 transition-opacity hover:opacity-70"
			style="background: var(--bg-elevated); color: var(--text);"
			onclick={onClose}
			aria-label={m.chat_close()}
			data-testid="report-close"
		>
			<X size={16} />
		</button>

		<!-- Title -->
		<h2 class="mb-4 text-base font-semibold" style="color: var(--text);">
			{m.report_title()}
		</h2>

		<!-- Quoted message -->
		<div
			class="mb-4 rounded px-3 py-2 text-xs"
			style="background: var(--bg-elevated); color: var(--text-muted); border-left: 3px solid var(--border);"
		>
			{truncatedBody}
		</div>

		{#if status === 'success'}
			<p class="text-sm" style="color: var(--success);" data-testid="report-success">
				{m.report_success()}
			</p>
		{:else}
			<!-- Reason radio buttons -->
			<fieldset class="mb-4 space-y-2">
				<legend class="sr-only">{m.report_title()}</legend>
				{#each reasons as r (r.value)}
					<label
						class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors"
						style="color: var(--text); background: {reason === r.value ? 'var(--bg-elevated)' : 'transparent'};"
					>
						<input
							type="radio"
							name="report-reason"
							value={r.value}
							checked={reason === r.value}
							onchange={() => (reason = r.value)}
							class="accent-current"
							style="accent-color: var(--accent);"
							data-testid="report-reason-{r.value}"
						/>
						{r.label()}
					</label>
				{/each}
			</fieldset>

			<!-- Details textarea -->
			<textarea
				class="mb-4 w-full resize-none rounded px-3 py-2 text-sm"
				style="background: var(--bg-elevated); color: var(--text); border: 1px solid var(--border);"
				rows="3"
				placeholder={m.report_details_placeholder()}
				aria-label={m.report_details_placeholder()}
				bind:value={details}
				data-testid="report-details"
			></textarea>

			{#if status === 'error'}
				<p class="mb-3 text-xs" style="color: var(--danger);" data-testid="report-error">
					{m.report_error()}
				</p>
			{/if}

			<!-- Submit button -->
			<button
				class="w-full rounded px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
				style="background: var(--danger); color: var(--text);"
				disabled={!canSubmit}
				onclick={handleSubmit}
				data-testid="report-submit"
			>
				{#if status === 'submitting'}
					{m.report_submitting()}
				{:else}
					{m.report_submit()}
				{/if}
			</button>
		{/if}
	</div>
</div>
