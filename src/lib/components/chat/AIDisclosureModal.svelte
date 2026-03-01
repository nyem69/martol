<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ShieldAlert } from '@lucide/svelte';

	let {
		roomId,
		onAcknowledge
	}: {
		roomId: string;
		onAcknowledge: () => void;
	} = $props();

	let submitting = $state(false);

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleAcknowledge();
	}

	async function handleAcknowledge() {
		if (submitting) return;
		submitting = true;
		try {
			await fetch('/api/terms', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ types: ['aup'] })
			});
		} catch {
			// Non-critical — localStorage still records acknowledgment
		}
		localStorage.setItem(`ai-disclosed-${roomId}`, '1');
		onAcknowledge();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center p-4"
	style="background: rgba(0, 0, 0, 0.85);"
	role="dialog"
	aria-modal="true"
	aria-label={m.ai_disclosure_title()}
>
	<!-- Backdrop (no close on click — user must acknowledge) -->
	<div class="absolute inset-0" aria-hidden="true"></div>

	<div
		class="relative z-10 w-full max-w-md rounded-xl p-6"
		style="background: var(--bg-elevated); border: 1px solid var(--border);"
	>
		<!-- Icon + Title -->
		<div class="mb-4 flex items-center gap-3">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
				style="background: color-mix(in oklch, var(--accent) 15%, transparent);"
			>
				<ShieldAlert size={20} style="color: var(--accent);" />
			</div>
			<h2
				class="text-base font-bold"
				style="color: var(--text);"
			>
				{m.ai_disclosure_title()}
			</h2>
		</div>

		<!-- Body -->
		<p
			class="mb-6 text-sm leading-relaxed"
			style="color: var(--text-muted);"
		>
			{m.ai_disclosure_body()}
		</p>

		<!-- Acknowledge button -->
		<button
			class="w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-85"
			style="background: var(--accent); color: var(--bg);"
			onclick={handleAcknowledge}
			disabled={submitting}
			data-testid="ai-disclosure-acknowledge"
		>
			{m.ai_disclosure_understand()}
		</button>
	</div>
</div>
