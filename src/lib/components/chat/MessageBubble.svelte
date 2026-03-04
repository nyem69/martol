<script lang="ts">
	import type { DisplayMessage } from '$lib/stores/messages.svelte';
	import { renderMarkdown } from '$lib/utils/markdown';
	import * as m from '$lib/paraglide/messages';
	import { Flag, Reply, RotateCcw } from '@lucide/svelte';
	import ImageModal from './ImageModal.svelte';

	let {
		message,
		replyParent,
		onRetry,
		onReply,
		onReport
	}: {
		message: DisplayMessage;
		replyParent?: DisplayMessage;
		onRetry?: (localId: string) => void;
		onReply?: (message: DisplayMessage) => void;
		onReport?: (messageId: number, messageBody: string) => void;
	} = $props();

	let now = $state(Date.now());
	const timeStr = $derived(formatRelativeTime(message.timestamp, now));
	const htmlBody = $derived(renderMarkdown(message.body));

	let lightboxSrc = $state<string | null>(null);
	let lightboxAlt = $state('');

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
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d`;
	}

	function handleImageClick(e: MouseEvent) {
		const img = (e.target as HTMLElement).closest('img.r2-image') as HTMLImageElement | null;
		if (!img) return;
		lightboxSrc = img.getAttribute('src');
		lightboxAlt = img.getAttribute('alt') || '';
	}

	function scrollToParent() {
		if (!replyParent?.dbId) return;
		const target = document.querySelector(`[data-dbid="${replyParent.dbId}"]`);
		if (target) {
			target.scrollIntoView({ behavior: 'smooth', block: 'center' });
			target.classList.add('highlight-flash');
			setTimeout(() => target.classList.remove('highlight-flash'), 1500);
		}
	}
</script>

<div
	class="msg-row group flex items-end gap-1.5 px-4 py-0.5 {message.isOwn ? 'flex-row-reverse' : ''}"
	style:opacity={message.pending ? '0.6' : '1'}
	data-dbid={message.dbId ?? undefined}
>
	<!-- Bubble -->
	<div
		class="bubble max-w-[75%] min-w-0 rounded-lg px-3 py-1.5"
		style="background: {message.isOwn
			? 'var(--bubble-own)'
			: 'var(--bg-surface)'}; border: 1px solid {message.failed
			? 'var(--danger)'
			: 'var(--border-subtle)'};"
	>
		{#if replyParent}
			<button
				class="reply-quote mb-1 flex w-full cursor-pointer items-center truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[10px] transition-colors"
				style="border-color: var(--accent); background: color-mix(in oklch, var(--bg) 50%, transparent); color: var(--text-muted);"
				onclick={scrollToParent}
			>
				<span class="shrink-0 font-medium" style="color: var(--accent);">{replyParent.senderName}</span>
				<span class="ml-1 truncate">{replyParent.body.slice(0, 80)}</span>
			</button>
		{/if}
		{#if !message.isOwn}
			<div class="mb-0.5 flex items-center gap-1.5">
				<span class="text-[11px] font-medium" style="color: var(--accent);">
					{message.senderName}
				</span>
				<span
					class="rounded px-1 text-[9px] uppercase"
					style="background: var(--bg-elevated); color: var(--text-muted); font-family: var(--font-mono);"
				>
					{message.senderRole}
				</span>
			</div>
		{/if}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
		<article class="prose text-sm" style="color: {message.isOwn ? 'var(--bubble-own-text)' : 'var(--text)'};" onclick={handleImageClick}>
			{@html htmlBody}
		</article>
		{#if message.pending}
			<span class="text-[10px] animate-pulse" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 70%, transparent)' : 'var(--text-muted)'};">
				{m.chat_sending()}
			</span>
		{:else if message.failed}
			<div class="flex items-center gap-1">
				<span class="text-[10px]" style="color: var(--danger);">{m.chat_failed()}</span>
				{#if onRetry}
					<button
						class="rounded p-0.5"
						style="color: var(--danger);"
						onclick={() => onRetry(message.localId)}
						aria-label={m.chat_retry()}
					>
						<RotateCcw size={11} />
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Side column: time + actions -->
	<div class="side-col flex shrink-0 flex-col items-center gap-0.5 pb-0.5 {message.isOwn ? 'items-end' : 'items-start'}">
		{#if timeStr !== 'now'}
			<time
				datetime={message.timestamp}
				class="text-[10px] leading-none"
				style="color: var(--text-muted); font-family: var(--font-mono);"
			>
				{timeStr}
			</time>
		{/if}
		{#if !message.pending && !message.failed && message.dbId}
			<div class="msg-actions flex items-center gap-0.5">
				{#if onReply}
					<button
						class="msg-action rounded p-0.5 transition-colors"
						style="color: var(--text-muted);"
						onclick={() => onReply(message)}
						aria-label={m.chat_reply_to({ name: message.senderName })}
					>
						<Reply size={12} />
					</button>
				{/if}
				{#if onReport && !message.isOwn}
					<button
						class="msg-action rounded p-0.5 transition-colors"
						style="color: var(--text-muted);"
						onclick={() => onReport(message.dbId!, message.body)}
						aria-label={m.report_title()}
						data-testid="report-button"
					>
						<Flag size={11} />
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if lightboxSrc}
	<ImageModal src={lightboxSrc} alt={lightboxAlt} onClose={() => (lightboxSrc = null)} />
{/if}

<style>
	.side-col {
		min-width: 2rem;
	}

	.msg-action {
		opacity: 0;
		transition: opacity 150ms ease;
	}

	.msg-action:hover {
		background: color-mix(in oklch, var(--bg-surface) 60%, transparent);
	}

	:global(.group):hover .msg-action {
		opacity: 1;
	}

	@media (hover: none) {
		.msg-action {
			opacity: 0.6;
		}
	}

	.reply-quote:hover {
		background: color-mix(in oklch, var(--bg) 30%, transparent) !important;
	}

	:global(.highlight-flash) {
		animation: flash 1.5s ease-out;
	}

	@keyframes flash {
		0%, 15% { background: color-mix(in oklch, var(--accent) 20%, transparent); }
		100% { background: transparent; }
	}

	:global(.r2-image) {
		max-width: 300px;
		max-height: 240px;
		border-radius: 0.375rem;
		object-fit: cover;
		display: block;
		margin: 0.5rem 0;
	}
</style>
