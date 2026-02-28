<script lang="ts">
	import type { DisplayMessage, SystemEvent } from '$lib/stores/messages.svelte';
	import * as m from '$lib/paraglide/messages';
	import MessageBubble from './MessageBubble.svelte';
	import SystemLine from './SystemLine.svelte';

	let {
		messages,
		systemEvents
	}: {
		messages: DisplayMessage[];
		systemEvents: SystemEvent[];
	} = $props();

	let container: HTMLDivElement | undefined = $state();
	let isAtBottom = $state(true);
	let hasNewMessages = $state(false);

	function onScroll() {
		if (!container) return;
		const threshold = 100;
		isAtBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
		if (isAtBottom) hasNewMessages = false;
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
		if (isAtBottom) {
			// Use tick-like microtask to scroll after DOM update
			queueMicrotask(() => scrollToBottom());
		} else {
			hasNewMessages = true;
		}
	});
</script>

<div
	class="relative flex-1 overflow-y-auto"
	style="background: var(--bg);"
	bind:this={container}
	onscroll={onScroll}
>
	<div class="flex min-h-full flex-col justify-end py-4">
		{#each timeline as item (item.kind === 'message' ? item.data.localId : `sys-${item.data.timestamp}`)}
			{#if item.kind === 'message'}
				<MessageBubble message={item.data} />
			{:else}
				{@const event = item.data}
				<SystemLine
					text={event.type === 'join'
						? m.chat_joined({ name: event.name })
						: m.chat_left({ name: event.name })}
				/>
			{/if}
		{/each}
	</div>

	{#if hasNewMessages}
		<button
			class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg"
			style="background: var(--accent); color: var(--bg);"
			onclick={scrollToBottom}
		>
			{m.chat_new_messages()}
		</button>
	{/if}
</div>
