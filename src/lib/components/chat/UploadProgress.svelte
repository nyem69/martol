<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { progress, filename }: { progress: number; filename: string } = $props();
</script>

{#if progress > 0 && progress < 100}
	<div
		class="flex items-center gap-2 px-3 py-1.5 text-xs"
		style="color: var(--text-muted);"
		data-testid="upload-progress"
	>
		<div class="h-1 flex-1 overflow-hidden rounded-full" style="background: var(--bg-elevated);">
			<div
				class="h-full rounded-full transition-all duration-200"
				style="background: var(--accent); width: {progress}%;"
			></div>
		</div>
		<span class="shrink-0">{m.upload_uploading({ filename })}</span>
	</div>
{/if}
