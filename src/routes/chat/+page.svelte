<script lang="ts">
	import { onMount } from 'svelte';
	import { MessagesStore, type DisplayMessage } from '$lib/stores/messages.svelte';
	import * as m from '$lib/paraglide/messages';
	import ConnectionBanner from '$lib/components/chat/ConnectionBanner.svelte';
	import ChatHeader from '$lib/components/chat/ChatHeader.svelte';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';
	import MemberPanel from '$lib/components/chat/MemberPanel.svelte';

	let { data } = $props();

	// These values are stable for the page lifetime (server load runs once, no invalidation).
	// svelte-ignore state_referenced_locally — intentional: capturing initial snapshot for store.
	const { roomId, userId, userName, userRole, roomName, initialMessages } = data;

	// Convert DB messages to DisplayMessage format
	const dbMessages: DisplayMessage[] = initialMessages.map((msg: (typeof initialMessages)[number]) => ({
		localId: `db-${msg.dbId}`,
		dbId: msg.dbId,
		senderId: msg.senderId,
		senderName: msg.senderId === userId ? userName : (msg.senderName ?? msg.senderId),
		senderRole: msg.senderRole,
		body: msg.body,
		timestamp: msg.createdAt,
		pending: false,
		failed: false,
		isOwn: msg.senderId === userId
	}));

	const store = new MessagesStore(roomId, userId, userName, userRole, dbMessages);

	let memberPanelOpen = $state(false);
	let replyTo = $state<{ dbId: number; senderName: string; body: string } | null>(null);

	function handleCommand(command: string, args: string) {
		// Send as distinct command type — not broadcast as chat text
		store.ws.send({ type: 'command', name: command, args });
	}

	function handleReply(message: DisplayMessage) {
		if (!message.dbId) return;
		replyTo = { dbId: message.dbId, senderName: message.senderName, body: message.body };
	}

	onMount(() => {
		store.connect();
		return () => store.disconnect();
	});
</script>

<svelte:head>
	<title>Chat — Martol</title>
</svelte:head>

<main class="flex h-dvh" aria-label="Chat room: {roomName}">
	<div class="flex flex-1 flex-col overflow-hidden">
		<ConnectionBanner status={store.ws.status} reconnectAttempt={store.ws.reconnectAttempt} />
		<ChatHeader
			roomName={roomName}
			onlineCount={store.onlineUsers.size}
			onToggleMembers={() => (memberPanelOpen = !memberPanelOpen)}
		/>

		<MessageList
			messages={store.messages}
			systemEvents={store.systemEvents}
			loading={store.ws.status === 'connecting'}
			onRetry={(localId) => store.retrySend(localId)}
			onReply={handleReply}
		/>

		<ChatInput
			onSend={(body, replyToId) => {
				store.sendMessage(body, replyToId);
				replyTo = null;
			}}
			onTyping={() => store.notifyTyping()}
			onCommand={handleCommand}
			disabled={store.ws.status !== 'connected'}
			typingNames={store.typingNames}
			{userRole}
			onlineUsers={store.onlineUsers}
			{replyTo}
			onCancelReply={() => (replyTo = null)}
		/>

		{#if store.error}
			<div
				class="absolute top-16 left-1/2 z-20 -translate-x-1/2 rounded-lg px-4 py-2 text-xs shadow-lg"
				style="background: var(--danger); color: var(--text);"
				role="alert"
			>
				{store.error}
				<button
					class="ml-2 underline"
					onclick={() => (store.error = null)}
					aria-label={m.chat_dismiss()}
				>
					{m.chat_dismiss()}
				</button>
			</div>
		{/if}
	</div>

	<MemberPanel
		open={memberPanelOpen}
		onClose={() => (memberPanelOpen = false)}
		onlineUsers={store.onlineUsers}
	/>
</main>
