<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.invite_not_found_title()} — {m.app_name()}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex min-h-dvh items-center justify-center px-4" style="background: var(--bg);">
	<div
		class="w-full max-w-sm"
		style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem;"
	>
		<div class="mb-6 text-center">
			<h1
				class="text-2xl font-bold tracking-widest"
				style="color: var(--accent); font-family: var(--font-mono);"
			>
				MARTOL
			</h1>
			<p class="mt-1 text-xs" style="color: var(--text-muted);">
				{m.invite_title()}
			</p>
		</div>

		<div
			class="mb-6 rounded-lg p-4 text-center"
			style="background: color-mix(in oklch, var(--text-muted) 10%, transparent);"
		>
			<p class="text-sm font-medium" style="color: var(--text);">
				{m.invite_not_found_title()}
			</p>
			<p class="mt-2 text-xs" style="color: var(--text-muted);">
				{m.invite_not_found()}
			</p>
			{#if page.status}
				<p class="mt-3 text-[10px]" style="color: var(--text-muted); font-family: var(--font-mono);">
					{page.status}
				</p>
			{/if}
		</div>

		<a
			href="/chat"
			class="flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-xs transition-opacity hover:opacity-80"
			style="color: var(--text-muted); border: 1px solid var(--border); text-decoration: none; font-family: var(--font-mono);"
		>
			{m.invite_go_to_chat()}
		</a>
	</div>
</div>
