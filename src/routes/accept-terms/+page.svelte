<script lang="ts">
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	let loading = $state(false);
	let error = $state('');

	// Track checkbox state per pending type
	let accepted = $state<Record<string, boolean>>({});

	const allChecked = $derived(
		data.pendingTerms.every((t: { type: string }) => accepted[t.type])
	);

	function labelForType(type: string): string {
		switch (type) {
			case 'tos':
				return m.legal_terms();
			case 'privacy':
				return m.legal_privacy();
			case 'aup':
				return m.legal_aup();
			default:
				return type;
		}
	}

	function urlForType(type: string): string {
		switch (type) {
			case 'tos':
				return '/legal/terms';
			case 'privacy':
				return '/legal/privacy';
			case 'aup':
				return '/legal/aup';
			default:
				return '#';
		}
	}

	async function handleAccept() {
		if (!allChecked) return;
		loading = true;
		error = '';

		try {
			const types = data.pendingTerms.map((t: { type: string }) => t.type);
			const res = await fetch('/api/terms', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ types })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = (body as any)?.message || m.error_generic();
				return;
			}

			goto('/chat');
		} catch {
			error = m.error_generic();
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{m.terms_reaccept_title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center px-4" style="background: var(--bg);">
	<div
		class="w-full max-w-sm"
		style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem;"
	>
		<!-- Header -->
		<div class="mb-8 text-center">
			<h1
				class="text-2xl font-bold tracking-widest"
				style="color: var(--accent); font-family: var(--font-mono);"
			>
				MARTOL
			</h1>
			<h2 class="mt-4 text-lg font-semibold" style="color: var(--text);">
				{m.terms_reaccept_title()}
			</h2>
			<p class="mt-2 text-sm" style="color: var(--text-muted);">
				{m.terms_reaccept_subtitle()}
			</p>
		</div>

		<!-- Pending terms list -->
		<div class="flex flex-col gap-3">
			{#each data.pendingTerms as term (term.type)}
				<label
					class="flex cursor-pointer items-start gap-3 rounded-lg p-3"
					style="background: var(--bg); border: 1px solid var(--border);"
				>
					<input
						type="checkbox"
						bind:checked={accepted[term.type]}
						data-testid="terms-checkbox-{term.type}"
						class="mt-0.5 shrink-0 rounded"
						style="accent-color: var(--accent);"
					/>
					<div class="flex flex-col gap-1">
						<div class="flex items-center gap-2">
							<a
								href={urlForType(term.type)}
								class="text-sm font-medium underline"
								style="color: var(--accent);"
								target="_blank"
								rel="noopener noreferrer"
							>
								{labelForType(term.type)}
							</a>
							<span
								class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
								style="background: var(--accent); color: var(--bg);"
							>
								{m.terms_reaccept_updated()}
							</span>
						</div>
						<p class="text-xs" style="color: var(--text-muted);">
							{term.summary}
						</p>
						<p class="text-[10px]" style="color: var(--text-muted); opacity: 0.6;">
							v{term.version}
						</p>
					</div>
				</label>
			{/each}
		</div>

		<!-- Submit -->
		<button
			onclick={handleAccept}
			disabled={!allChecked || loading}
			data-testid="accept-terms-btn"
			class="mt-6 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
			style="background: var(--accent); color: var(--bg); letter-spacing: 0.5px;"
		>
			{#if loading}
				<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
			{/if}
			{m.terms_reaccept_accept()}
		</button>

		{#if error}
			<p class="mt-4 text-center text-sm" style="color: var(--danger);" data-testid="error-msg">
				{error}
			</p>
		{/if}
	</div>
</div>
