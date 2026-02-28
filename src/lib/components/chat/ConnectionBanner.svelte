<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { status, reconnectAttempt }: { status: string; reconnectAttempt: number } = $props();
</script>

{#if status !== 'connected'}
	<div
		class="flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium"
		style="background: var(--warning); color: var(--bg);"
		role="status"
		aria-live="polite"
	>
		<span
			class="inline-block h-2 w-2 animate-pulse rounded-full"
			style="background: var(--bg);"
		></span>
		{#if status === 'connecting'}
			{m.chat_connecting()}
		{:else if status === 'reconnecting'}
			{m.chat_reconnecting({ attempt: String(reconnectAttempt) })}
		{/if}
	</div>
{/if}
