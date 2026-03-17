<script lang="ts">
	import { untrack } from 'svelte';
	import type { DisplayMessage, SystemEvent } from '$lib/stores/messages.svelte';
	import type { PendingAction } from '$lib/types/chat';
	import type { TimelineItem, ToolCallGroup } from '$lib/types/timeline';
	import { isToolCallMessage, parseToolCallBody } from '$lib/utils/tool-call-parser';
	import * as m from '$lib/paraglide/messages';
	import MessageBubble from './MessageBubble.svelte';
	import SystemLine from './SystemLine.svelte';
	import PendingActionLine from './PendingActionLine.svelte';
	import ToolCallGroupComponent from './ToolCallGroup.svelte';

	let {
		messages,
		systemEvents,
		actions = [],
		actionsInFlight = new Set<number>(),
		loading = false,
		loadingHistory = false,
		hasMoreHistory = true,
		canApproveActions = false,
		onRetry,
		onReply,
		onReport,
		onLoadMore,
		onApproveAction,
		onRejectAction
	}: {
		messages: DisplayMessage[];
		systemEvents: SystemEvent[];
		actions?: PendingAction[];
		actionsInFlight?: Set<number>;
		loading?: boolean;
		loadingHistory?: boolean;
		hasMoreHistory?: boolean;
		canApproveActions?: boolean;
		onRetry?: (localId: string) => void;
		onReply?: (message: DisplayMessage) => void;
		onReport?: (messageId: number, messageBody: string) => void;
		onLoadMore?: () => void;
		onApproveAction?: (id: number) => void;
		onRejectAction?: (id: number) => void;
	} = $props();

	// Lookup map for reply threading: dbId → message
	const messageByDbId = $derived(new Map(messages.filter((m) => m.dbId).map((m) => [m.dbId!, m])));

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

	// Merge messages, system events, and actions into a single timeline
	const timeline = $derived.by(() => {
		// Deduplicate agent intro messages — keep only the latest per sender.
		// Agent intros start with "[AI Agent]" and repeat on every reconnect.
		const lastIntroId = new Map<string, string>();
		for (const msg of messages) {
			if (msg.senderRole === 'agent' && msg.body.startsWith('[AI Agent]')) {
				lastIntroId.set(msg.senderId, msg.localId);
			}
		}

		const filtered = messages.filter((msg) => {
			if (msg.senderRole === 'agent' && msg.body.startsWith('[AI Agent]')) {
				return msg.localId === lastIntroId.get(msg.senderId);
			}
			return true;
		});

		const items: TimelineItem[] = [
			...filtered.map((m) => ({ kind: 'message' as const, data: m })),
			...systemEvents.map((e) => ({ kind: 'system' as const, data: e })),
			...actions.map((a) => ({ kind: 'action' as const, data: a }))
		];

		items.sort(
			(a, b) => new Date(a.data.timestamp).getTime() - new Date(b.data.timestamp).getTime()
		);

		return groupToolCalls(items);
	});

	/** Group consecutive tool-call messages from the same agent into a single ToolCallGroup item. */
	function groupToolCalls(items: TimelineItem[]): TimelineItem[] {
		const result: TimelineItem[] = [];
		let currentGroup: { agentId: string; messages: DisplayMessage[] } | null = null;

		function flushGroup() {
			if (!currentGroup || currentGroup.messages.length === 0) return;
			const msgs = currentGroup.messages;
			const first = msgs[0];
			const last = msgs[msgs.length - 1];
			const group: ToolCallGroup = {
				groupId: first.localId,
				agentId: first.senderId,
				agentName: first.senderName,
				agentRole: first.senderRole,
				messages: msgs.map(parseToolCallBody),
				timestamp: last.timestamp,
				isStreaming: msgs.some((m) => !!m.streaming)
			};
			result.push({ kind: 'tool_group', data: group });
			currentGroup = null;
		}

		for (const item of items) {
			if (item.kind === 'message' && isToolCallMessage(item.data)) {
				const msg = item.data;
				if (currentGroup && currentGroup.agentId === msg.senderId) {
					currentGroup.messages.push(msg);
				} else {
					flushGroup();
					currentGroup = { agentId: msg.senderId, messages: [msg] };
				}
			} else {
				flushGroup();
				result.push(item);
			}
		}
		flushGroup();
		return result;
	}

	// Auto-scroll when new messages arrive and user is at bottom
	// [I8] Only show "new messages" pill for actual messages, not action refreshes
	$effect(() => {
		const _len = timeline.length;
		const lastItem = timeline[timeline.length - 1];
		const atBottom = untrack(() => isAtBottom);
		if (atBottom) {
			queueMicrotask(() => scrollToBottom());
		} else if (lastItem?.kind === 'message') {
			hasNewMessages = true;
		}
	});

	// [I1] Auto-scroll during streaming deltas — content height grows but timeline length doesn't change
	$effect(() => {
		if (!container) return;
		const contentEl = container.firstElementChild as HTMLElement | null;
		if (!contentEl) return;

		const observer = new ResizeObserver(() => {
			const hasStreaming = messages.some((m) => m.streaming);
			if (hasStreaming && isAtBottom) {
				scrollToBottom();
			}
		});
		observer.observe(contentEl);

		return () => observer.disconnect();
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

		{#each timeline as item (item.kind === 'message' ? item.data.localId : item.kind === 'action' ? `action-${item.data.id}` : item.kind === 'tool_group' ? `tg-${item.data.groupId}` : item.data.id)}
			{#if item.kind === 'message'}
				<MessageBubble message={item.data} replyParent={item.data.replyTo ? messageByDbId.get(item.data.replyTo) : undefined} {onRetry} {onReply} {onReport} />
			{:else if item.kind === 'tool_group'}
				<ToolCallGroupComponent group={item.data} />
			{:else if item.kind === 'action'}
				<PendingActionLine
					action={item.data}
					canApprove={canApproveActions}
					loading={actionsInFlight.has(item.data.id)}
					onApprove={onApproveAction}
					onReject={onRejectAction}
				/>
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
