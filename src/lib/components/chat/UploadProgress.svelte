<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { active, filename }: { active: boolean; filename: string } = $props();
</script>

{#if active}
	<div
		class="flex items-center gap-2 px-3 py-1.5 text-xs"
		style="color: var(--text-muted);"
		data-testid="upload-progress"
	>
		<div class="h-1 flex-1 overflow-hidden rounded-full" style="background: var(--bg-elevated);">
			<div class="upload-bar h-full rounded-full" style="background: var(--accent);"></div>
		</div>
		<span class="max-w-[10rem] shrink-0 truncate">{m.upload_uploading({ filename })}</span>
	</div>
{/if}

<style>
	.upload-bar {
		width: 40%;
		animation: slide 1.2s ease-in-out infinite;
	}
	@keyframes slide {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(350%); }
	}
</style>
