<script lang="ts">
	let { text, type = 'join' }: { text: string; type?: 'join' | 'leave' | 'clear' } = $props();
</script>

<div class="py-1 text-center" role="status">
	<span
		class="text-xs"
		style="color: {type === 'leave' ? 'var(--danger)' : type === 'clear' ? 'var(--text-muted)' : 'var(--success)'}; opacity: 0.8;"
	>
		{type === 'join' ? '+' : type === 'clear' ? '⟳' : '−'} {text}
	</span>
</div>
