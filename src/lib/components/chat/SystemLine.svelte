<script lang="ts">
	let { text, type = 'join' }: { text: string; type?: 'join' | 'leave' } = $props();
</script>

<div class="py-1 text-center" role="status">
	<span
		class="text-xs"
		style="color: {type === 'leave' ? 'var(--danger)' : 'var(--success)'}; opacity: 0.8;"
	>
		{type === 'join' ? '+' : '−'} {text}
	</span>
</div>
