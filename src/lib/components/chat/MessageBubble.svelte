<script lang="ts">
	import type { DisplayMessage } from '$lib/stores/messages.svelte';
	import { renderMarkdown } from '$lib/utils/markdown';
	import * as m from '$lib/paraglide/messages';
	import { BookOpen, Flag, Reply, RotateCcw } from '@lucide/svelte';
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
	let lightboxSrc = $state<string | null>(null);
	let lightboxAlt = $state('');
	const timeStr = $derived(formatRelativeTime(message.timestamp, now));
	// Throttle markdown rendering during streaming to avoid per-delta re-renders
	let streamRenderedHtml = $state('');
	let streamThrottleTimer: ReturnType<typeof setTimeout> | null = null;

	const htmlBody = $derived.by(() => {
		let html: string;
		if (!message.streaming) {
			if (streamThrottleTimer) {
				clearTimeout(streamThrottleTimer);
				streamThrottleTimer = null;
			}
			html = renderMarkdown(message.body);
		} else {
			html = streamRenderedHtml || renderMarkdown(message.body);
		}
		if (message.streaming) {
			// Inject cursor inside the last closing block tag
			html = html.replace(/<\/(p|li|td|blockquote|pre|h[1-6])>\s*$/, '<span class="streaming-cursor"></span></$1>');
			// Fallback if no block tags (plain text)
			if (!html.includes('streaming-cursor')) {
				html += '<span class="streaming-cursor"></span>';
			}
		}
		return html;
	});

	let latestStreamBody = $state('');

	$effect(() => {
		if (!message.streaming) return;
		latestStreamBody = message.body;
		if (streamThrottleTimer) return;
		streamThrottleTimer = setTimeout(() => {
			streamThrottleTimer = null;
			streamRenderedHtml = renderMarkdown(latestStreamBody);
		}, 150);
	});

	$effect(() => {
		return () => {
			if (streamThrottleTimer) {
				clearTimeout(streamThrottleTimer);
				streamThrottleTimer = null;
			}
		};
	});

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

	function handleCitationClick(e: MouseEvent) {
		const citation = (e.target as HTMLElement).closest('.doc-citation') as HTMLElement | null;
		if (!citation) return;
		const filename = citation.dataset.filename;
		if (filename) {
			document.dispatchEvent(new CustomEvent('martol:open-document', { detail: { filename } }));
		}
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
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="bubble max-w-[75%] min-w-0 rounded-lg px-3 py-1.5"
		aria-busy={message.streaming || undefined}
		style="background: {message.isOwn
			? 'var(--bubble-own)'
			: 'var(--bg-surface)'}; border: 1px solid {message.failed
			? 'var(--danger)'
			: 'var(--border-subtle)'};{message.subtype === 'rag_response' ? ' border-left: 2px solid var(--warning);' : ''}"
	>
		{#if replyParent}
			<button
				class="reply-quote mb-1 flex w-full cursor-pointer items-center truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[10px] transition-colors"
				style="border-color: var(--accent); background: color-mix(in oklch, var(--bg) 50%, transparent); color: var(--text-muted);"
				onclick={scrollToParent}
			>
				<span class="shrink-0 font-medium" style="color: var(--accent);">{replyParent.senderName}</span>
				<span class="ml-1 truncate">{replyParent.body.replace(/!\[[^\]]*\]\([^)]+\)/g, '[image]').slice(0, 80)}</span>
			</button>
		{/if}
		{#if !message.isOwn}
			<div class="mb-0.5 flex items-center gap-1.5">
				<span class="text-[11px] font-medium" style="color: var(--accent);">
					{message.senderName}
				</span>
				{#if message.subtype === 'rag_response'}
					<span
						class="rounded px-1 text-[9px] uppercase flex items-center gap-0.5"
						style="background: color-mix(in oklch, var(--warning) 15%, transparent); color: var(--warning); font-family: var(--font-mono);"
					>
						<BookOpen size={9} />
						{m.rag_docs_ai()}
					</span>
					<span
						class="rounded px-0.5 text-[8px] uppercase"
						style="color: var(--text-muted); font-family: var(--font-mono);"
					>
						{m.rag_beta()}
					</span>
				{:else}
					<span
						class="rounded px-1 text-[9px] uppercase"
						style="background: var(--bg-elevated); color: var(--text-muted); font-family: var(--font-mono);"
					>
						{message.senderRole}
					</span>
				{/if}
			</div>
		{/if}
		<article
			class="prose text-sm"
			style="color: {message.isOwn ? 'var(--bubble-own-text)' : 'var(--text)'};"
			role="presentation"
			onclick={(e) => { handleImageClick(e); handleCitationClick(e); }}
			onkeydown={(e) => { if (e.key === 'Enter') { handleImageClick(e as unknown as MouseEvent); handleCitationClick(e as unknown as MouseEvent); } }}
		>
			{@html htmlBody}
		</article>
		{#if message.editedAt}
			<span class="text-[10px]" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 60%, transparent)' : 'var(--text-muted)'};">
				({m.chat_edited()})
			</span>
		{/if}
		{#if message.streaming}
			<span class="text-[10px] animate-pulse" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 70%, transparent)' : 'var(--text-muted)'};">
				{m.chat_streaming()}
			</span>
		{:else if message.pending}
			<span class="text-[10px] animate-pulse" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 70%, transparent)' : 'var(--text-muted)'};">
				{m.chat_sending()}
			</span>
		{:else if message.failed}
			<div class="flex items-center gap-1">
				{#if !message.isOwn && !message.dbId}
					<span class="text-[10px]" style="color: var(--danger);">{m.chat_stream_interrupted()}</span>
				{:else}
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
				{/if}
			</div>
		{/if}
		{#if message.subtype === 'rag_response' && !message.streaming && !message.failed}
			{@const citationCount = (message.body.match(/\[📄[^\]]*\]/g) || []).length}
			{#if citationCount > 0}
				<span class="text-[10px]" style="color: var(--text-muted); font-family: var(--font-mono);">
					{m.rag_based_on({ count: String(citationCount) })}
				</span>
			{/if}
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
		{#if !message.pending && !message.streaming && !message.failed && message.dbId}
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

	:global(.group):hover .msg-action,
	:global(.group):focus-within .msg-action {
		opacity: 1;
	}

	@media (hover: none) {
		.msg-action {
			opacity: 0.6;
			min-width: 44px;
			min-height: 44px;
			display: flex;
			align-items: center;
			justify-content: center;
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

	:global(article.prose .r2-image) {
		max-width: 300px;
		max-height: 240px;
		border-radius: 0.375rem;
		object-fit: contain;
		background: var(--bg-elevated);
		display: block;
		margin: 0.5rem 0;
		cursor: zoom-in;
	}

	:global(article.prose .r2-file) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		background: color-mix(in oklch, var(--accent) 10%, transparent);
		color: var(--accent);
		font-size: 0.75rem;
		font-family: var(--font-mono);
		text-decoration: none;
		transition: background 150ms;
	}

	:global(article.prose .r2-file:hover) {
		background: color-mix(in oklch, var(--accent) 20%, transparent);
	}

	:global(article.prose .doc-citation) {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		background: color-mix(in oklch, var(--accent) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--accent) 20%, transparent);
		color: var(--accent);
		font-size: 0.675rem;
		font-family: var(--font-mono);
		cursor: pointer;
		transition: background 150ms;
		vertical-align: baseline;
	}

	:global(article.prose .doc-citation:hover) {
		background: color-mix(in oklch, var(--accent) 18%, transparent);
	}

	:global(.streaming-cursor) {
		display: inline-block;
		width: 2px;
		height: 1em;
		background: var(--accent);
		margin-left: 1px;
		vertical-align: text-bottom;
		animation: cursor-blink 1s step-end infinite;
	}

	@keyframes cursor-blink {
		0%, 50% { opacity: 1; }
		51%, 100% { opacity: 0; }
	}
</style>
