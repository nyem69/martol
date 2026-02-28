<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { status, reconnectAttempt }: { status: string; reconnectAttempt: number } = $props();
</script>

{#if status !== 'connected'}
	<div
		class="flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium"
		style="background: {status === 'failed' || status === 'closed'
			? 'var(--danger)'
			: 'var(--warning)'}; color: var(--bg);"
		role="status"
		aria-live="polite"
	>
		{#if status !== 'failed' && status !== 'closed'}
			<span
				class="inline-block h-2 w-2 animate-pulse rounded-full"
				style="background: var(--bg);"
				aria-hidden="true"
			></span>
		{/if}
		{#if status === 'connecting'}
			{m.chat_connecting()}
		{:else if status === 'reconnecting'}
			{m.chat_reconnecting({ attempt: String(reconnectAttempt) })}
		{:else if status === 'closed'}
			{m.chat_connection_closed()}
			<button onclick={() => window.location.reload()} class="ml-2 underline font-semibold">
				Refresh
			</button>
		{:else if status === 'failed'}
			{m.chat_connection_failed()}
			<button onclick={() => window.location.reload()} class="ml-2 underline font-semibold">
				Refresh
			</button>
		{/if}
	</div>
{/if}
