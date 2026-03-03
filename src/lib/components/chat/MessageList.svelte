<script lang="ts">
	import { untrack } from 'svelte';
	import type { DisplayMessage, SystemEvent } from '$lib/stores/messages.svelte';
	import * as m from '$lib/paraglide/messages';
	import MessageBubble from './MessageBubble.svelte';
	import SystemLine from './SystemLine.svelte';

	let {
		messages,
		systemEvents,
		loading = false,
		loadingHistory = false,
		hasMoreHistory = true,
		onRetry,
		onReply,
		onReport,
		onLoadMore
	}: {
		messages: DisplayMessage[];
		systemEvents: SystemEvent[];
		loading?: boolean;
		loadingHistory?: boolean;
		hasMoreHistory?: boolean;
		onRetry?: (localId: string) => void;
		onReply?: (message: DisplayMessage) => void;
		onReport?: (messageId: number, messageBody: string) => void;
		onLoadMore?: () => void;
	} = $props();

	let container: HTMLDivElement | undefined = $state();
	let isAtBottom = $state(true);
	let hasNewMessages = $state(false);
	let scrollTicking = false;

	function onScroll() {
		if (scrollTicking) return;
		scrollTicking = true;
		requestAnimationFrame(() => {
			if (!container) { scrollTicking = false; return; }
			const threshold = 100;
			isAtBottom =
				container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
			if (isAtBottom) hasNewMessages = false;

			// Pull-to-load: trigger when scrolled near the top
			if (container.scrollTop < 80 && hasMoreHistory && !loadingHistory && onLoadMore) {
				onLoadMore();
			}

			scrollTicking = false;
		});
	}

	function scrollToBottom() {
		if (!container) return;
		container.scrollTop = container.scrollHeight;
		hasNewMessages = false;
	}

	// Merge messages and system events into a single timeline
	const timeline = $derived.by(() => {
		type TimelineItem =
			| { kind: 'message'; data: DisplayMessage }
			| { kind: 'system'; data: SystemEvent };

		const items: TimelineItem[] = [
			...messages.map((m) => ({ kind: 'message' as const, data: m })),
			...systemEvents.map((e) => ({ kind: 'system' as const, data: e }))
		];

		items.sort(
			(a, b) => new Date(a.data.timestamp).getTime() - new Date(b.data.timestamp).getTime()
		);
		return items;
	});

	// Auto-scroll when new messages arrive and user is at bottom
	$effect(() => {
		// Access length to track changes
		const _len = timeline.length;
		// Read isAtBottom without tracking to avoid re-triggering on scroll
		const atBottom = untrack(() => isAtBottom);
		if (atBottom) {
			queueMicrotask(() => scrollToBottom());
		} else {
			hasNewMessages = true;
		}
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'End') {
			scrollToBottom();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions — role="log" with tabindex is a focusable scrollable region; onkeydown for End key is standard a11y -->
<div
	class="scrollbar-thin relative flex-1 overflow-y-auto"
	style="background: var(--bg);"
	bind:this={container}
	onscroll={onScroll}
	onkeydown={onKeydown}
	role="log"
	aria-live="polite"
	aria-busy={loading}
	tabindex="-1"
>
	<div class="flex min-h-full flex-col justify-end py-4">
		{#if loadingHistory}
			<div class="flex justify-center py-2">
				<span
					class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
					style="color: var(--text-muted);"
				></span>
			</div>
		{/if}
		{#if loading}
			<div class="flex flex-col gap-3 px-4 py-2" aria-label={m.chat_loading()}>
				{#each { length: 4 } as _}
					<div class="flex gap-2">
						<div
							class="h-8 w-8 shrink-0 animate-pulse rounded-full"
							style="background: var(--bg-elevated);"
						></div>
						<div class="flex-1 space-y-1.5">
							<div
								class="h-3 w-24 animate-pulse rounded"
								style="background: var(--bg-elevated);"
							></div>
							<div
								class="h-4 w-48 animate-pulse rounded"
								style="background: var(--bg-elevated);"
							></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if timeline.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
				<p class="text-sm" style="color: var(--text-muted);">
					{m.chat_empty()}
				</p>
			</div>
		{/if}

		{#each timeline as item (item.kind === 'message' ? item.data.localId : item.data.id)}
			{#if item.kind === 'message'}
				<MessageBubble message={item.data} {onRetry} {onReply} {onReport} />
			{:else}
				{@const event = item.data}
				<SystemLine
					text={event.type === 'join'
						? m.chat_joined({ name: event.name })
						: event.type === 'clear'
							? m.chat_cleared({ name: event.name })
							: m.chat_left({ name: event.name })}
					type={event.type}
				/>
			{/if}
		{/each}
	</div>

	{#if hasNewMessages}
		<button
			class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-medium shadow-lg active:scale-95"
			style="background: var(--accent); color: var(--bg); font-family: var(--font-mono);"
			onclick={scrollToBottom}
			aria-label={m.chat_new_messages()}
		>
			{m.chat_new_messages()}
		</button>
	{/if}
</div>
