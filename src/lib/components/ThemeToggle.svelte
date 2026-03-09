<script lang="ts">
	import { Sun, Moon } from '@lucide/svelte';
	import { themeStore } from '$lib/stores/theme.svelte';

	let { size = 16 }: { size?: number } = $props();
</script>

<button
	onclick={() => themeStore.toggleDarkLight()}
	class="theme-toggle"
	aria-label={themeStore.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	data-testid="theme-toggle"
>
	{#if themeStore.isDark}
		<Sun {size} />
	{:else}
		<Moon {size} />
	{/if}
</button>

<style>
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}

	.theme-toggle:hover {
		color: var(--accent);
		border-color: var(--accent-muted);
		background: color-mix(in oklch, var(--accent) 8%, transparent);
	}
</style>
