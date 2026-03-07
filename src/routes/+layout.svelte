<script lang="ts">
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();

	// Ensure theme is applied on mount (themeStore constructor reads localStorage)
	$effect(() => {
		// Access current to track it; re-apply when it changes
		const _theme = themeStore.current;
		themeStore.apply();
	});
</script>

<a
	href="#main-content"
	class="sr-only focus:not-sr-only fixed top-2 left-2 z-[100] rounded-md px-4 py-2 text-sm font-semibold focus:outline-2"
	style="background: var(--accent); color: var(--bg);"
>
	{m.skip_to_content()}
</a>

<div id="main-content" class="min-h-dvh">
	{@render children()}
</div>
