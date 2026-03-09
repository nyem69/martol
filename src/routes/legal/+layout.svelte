<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>{m.legal_title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex min-h-dvh justify-center px-4 py-8 overflow-y-auto h-dvh" style="background: var(--bg);">
	<div
		class="w-full max-w-2xl"
		style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem;"
	>
		<div class="mb-6 flex items-center justify-between">
			<button
				onclick={() => history.back()}
				class="inline-flex items-center gap-1 text-sm hover:underline"
				style="color: var(--text-muted); background: none; border: none; cursor: pointer; padding: 0;"
			>
				&larr; {m.login_back()}
			</button>
			<ThemeToggle />
		</div>

		{@render children()}

		<div
			class="mt-8 border-t pt-4 text-center text-xs"
			style="border-color: var(--border); color: var(--text-muted);"
		>
			<a href="/legal/terms" class="hover:underline" style="color: var(--accent);">{m.legal_terms()}</a>
			<span class="mx-2">|</span>
			<a href="/legal/privacy" class="hover:underline" style="color: var(--accent);">{m.legal_privacy()}</a>
			<span class="mx-2">|</span>
			<a href="/legal/aup" class="hover:underline" style="color: var(--accent);">{m.legal_aup()}</a>
		</div>
	</div>
</div>

<style>
	:global(.legal-content) {
		color: var(--text);
		line-height: 1.7;
	}

	:global(.legal-content h1) {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--accent);
		font-family: var(--font-mono);
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	:global(.legal-content .last-updated) {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-bottom: 1.5rem;
	}

	:global(.legal-content h2) {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		margin-top: 1.5rem;
		margin-bottom: 0.5rem;
	}

	:global(.legal-content p) {
		font-size: 0.875rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}

	:global(.legal-content ul) {
		font-size: 0.875rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
		padding-left: 1.25rem;
		list-style: disc;
	}

	:global(.legal-content li) {
		margin-bottom: 0.25rem;
	}

	:global(.legal-content a) {
		color: var(--accent);
		text-decoration: underline;
	}

	:global(.legal-content a:hover) {
		opacity: 0.8;
	}

	:global(.legal-content code) {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--accent);
		background: var(--bg);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
	}
</style>
