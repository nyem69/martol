<script lang="ts">
	import type { DisplayMessage } from '$lib/stores/messages.svelte';
	import { renderMarkdown } from '$lib/utils/markdown';
	import * as m from '$lib/paraglide/messages';
	import { Flag } from '@lucide/svelte';

	let {
		message,
		onRetry,
		onReply,
		onReport
	}: {
		message: DisplayMessage;
		onRetry?: (localId: string) => void;
		onReply?: (message: DisplayMessage) => void;
		onReport?: (messageId: number, messageBody: string) => void;
	} = $props();

	let now = $state(Date.now());
	const timeStr = $derived(formatRelativeTime(message.timestamp, now));
	const htmlBody = $derived(renderMarkdown(message.body));

	// Tick every 30s to keep relative timestamps fresh
	$effect(() => {
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
	class="group flex {message.isOwn ? 'justify-end' : 'justify-start'} px-4 py-1"
	style:opacity={message.pending ? '0.6' : '1'}
>
	<div
		class="max-w-[80%] rounded-lg px-3 py-2"
		style="background: {message.isOwn
			? 'var(--bubble-own)'
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
					class="rounded px-1 py-0.5 text-[11px] uppercase"
					style="background: var(--bg-elevated); color: var(--text-muted); font-family: var(--font-mono);"
				>
					{message.senderRole}
				</span>
			</div>
		{/if}
		<article class="prose text-sm" style="color: {message.isOwn ? 'var(--bubble-own-text)' : 'var(--text)'};">
			{@html htmlBody}
		</article>
		<div class="mt-1 flex items-center justify-end gap-2">
			{#if message.pending}
				<span class="text-[11px] animate-pulse" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 70%, transparent)' : 'var(--text-muted)'};">
					{m.chat_sending()}
				</span>
			{:else if message.failed}
				<span class="text-[11px]" style="color: var(--danger);">
					{m.chat_failed()}
				</span>
				{#if onRetry}
					<button
						class="rounded px-2 py-1 text-xs underline"
						style="color: var(--danger);"
						onclick={() => onRetry(message.localId)}
					>
						{m.chat_retry()}
					</button>
				{/if}
			{:else if message.dbId}
				{#if onReply}
					<button
						class="text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
						style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 60%, transparent)' : 'var(--text-muted)'};"
						onclick={() => onReply(message)}
						aria-label={m.chat_reply_to({ name: message.senderName })}
					>
						{m.chat_reply()}
					</button>
				{/if}
				{#if onReport && !message.isOwn}
					<button
						class="opacity-0 transition-opacity group-hover:opacity-100"
						style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 60%, transparent)' : 'var(--text-muted)'};"
						onclick={() => onReport(message.dbId!, message.body)}
						aria-label={m.report_title()}
						data-testid="report-button"
					>
						<Flag size={12} />
					</button>
				{/if}
			{/if}
			<time datetime={message.timestamp} class="text-[11px]" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 60%, transparent)' : 'var(--text-muted)'};">
				{timeStr}
			</time>
		</div>
	</div>
</div>
