<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { name, action }: { name: string; action?: string } = $props();
</script>

<div class="flex items-center gap-1 px-4 py-1" role="status" aria-live="polite">
	<span class="text-xs italic" style="color: var(--accent); opacity: 0.8;">
		* {m.chat_action_thinking({ name })}
		{#if action}
			<span style="color: var(--text-muted);">— {action}</span>
		{/if}
		<span class="inline-flex gap-0.5">
			<span class="animate-bounce" style="animation-delay: 0ms;">.</span>
			<span class="animate-bounce" style="animation-delay: 150ms;">.</span>
			<span class="animate-bounce" style="animation-delay: 300ms;">.</span>
		</span>
	</span>
</div>
