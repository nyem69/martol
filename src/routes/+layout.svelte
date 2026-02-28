<script lang="ts">
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';

	let { children } = $props();

	// Ensure theme is applied on mount (themeStore constructor reads localStorage)
	$effect(() => {
		// Access current to track it; re-apply when it changes
		const _theme = themeStore.current;
		themeStore.apply();
	});
</script>

<div class="min-h-dvh">
	{@render children()}
</div>
