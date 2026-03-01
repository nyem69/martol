<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();
</script>

<svelte:head>
	<title>{m.legal_title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center px-4 py-8" style="background: var(--bg);">
	<div
		class="w-full max-w-2xl"
		style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem;"
	>
		<div class="mb-6">
			<a
				href="/login"
				class="inline-flex items-center gap-1 text-sm hover:underline"
				style="color: var(--text-muted);"
			>
				&larr; {m.login_back()}
			</a>
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
			<a href="/legal/aup" class="hover:underline" style="color: var(--accent);">{m.legal_anthropic_terms()}</a>
		</div>
	</div>
</div>
