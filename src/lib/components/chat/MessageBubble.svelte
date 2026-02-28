<script lang="ts">
	import { onMount } from 'svelte';
	import type { DisplayMessage } from '$lib/stores/messages.svelte';
	import { renderMarkdown } from '$lib/utils/markdown';
	import * as m from '$lib/paraglide/messages';

	let {
		message,
		onRetry
	}: {
		message: DisplayMessage;
		onRetry?: (localId: string) => void;
	} = $props();

	let now = $state(Date.now());
	const timeStr = $derived(formatRelativeTime(message.timestamp, now));
	const htmlBody = $derived(renderMarkdown(message.body));

	// Tick every 30s to keep relative timestamps fresh
	onMount(() => {
		const interval = setInterval(() => {
			now = Date.now();
		}, 30_000);
		return () => clearInterval(interval);
	});

	function formatRelativeTime(iso: string, _now: number): string {
		const diff = _now - new Date(iso).getTime();
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return 'now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
</script>

<div
	class="flex {message.isOwn ? 'justify-end' : 'justify-start'} px-4 py-1"
	style:opacity={message.pending ? '0.6' : '1'}
>
	<div
		class="max-w-[80%] rounded-lg px-3 py-2"
		style="background: {message.isOwn
			? 'var(--accent-muted)'
			: 'var(--bg-surface)'}; border: 1px solid {message.failed
			? 'var(--danger)'
			: 'var(--border-subtle)'};"
	>
		{#if !message.isOwn}
			<div class="mb-1 flex items-center gap-2">
				<span class="text-xs font-medium" style="color: var(--accent);">
					{message.senderName}
				</span>
				<span
					class="rounded px-1 py-0.5 text-[10px] uppercase"
					style="background: var(--bg-elevated); color: var(--text-muted); font-family: var(--font-mono);"
				>
					{message.senderRole}
				</span>
			</div>
		{/if}
		<article class="prose text-sm" style="color: var(--text);">
			{@html htmlBody}
		</article>
		<div class="mt-1 flex items-center justify-end gap-2">
			{#if message.failed}
				<span class="text-[10px]" style="color: var(--danger);">
					{m.chat_failed()}
				</span>
				{#if onRetry}
					<button
						class="text-[10px] underline"
						style="color: var(--danger);"
						onclick={() => onRetry(message.localId)}
					>
						{m.chat_retry()}
					</button>
				{/if}
			{/if}
			<span class="text-[10px]" style="color: var(--text-muted);">
				{timeStr}
			</span>
		</div>
	</div>
</div>
