<script lang="ts">
	let { text }: { text: string } = $props();
</script>

<div class="py-1 text-center">
	<span class="text-xs" style="color: var(--text-muted);">
		{text}
	</span>
</div>
