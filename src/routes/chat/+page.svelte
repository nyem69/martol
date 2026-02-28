<script lang="ts">
	import { onMount } from 'svelte';
	import { MessagesStore, type DisplayMessage } from '$lib/stores/messages.svelte';
	import ConnectionBanner from '$lib/components/chat/ConnectionBanner.svelte';
	import ChatHeader from '$lib/components/chat/ChatHeader.svelte';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';

	let { data } = $props();

	// These values are stable for the page lifetime (from server load)
	const { roomId, userId, userName, userRole, roomName, initialMessages } = data;

	// Convert DB messages to DisplayMessage format
	const dbMessages: DisplayMessage[] = initialMessages.map((msg: (typeof initialMessages)[number]) => ({
		localId: `db-${msg.dbId}`,
		dbId: msg.dbId,
		senderId: msg.senderId,
		senderName: msg.senderId === userId ? userName : msg.senderId,
		senderRole: msg.senderRole,
		body: msg.body,
		timestamp: msg.createdAt,
		pending: false,
		failed: false,
		isOwn: msg.senderId === userId
	}));

	const store = new MessagesStore(roomId, userId, userName, userRole, dbMessages);

	onMount(() => {
		store.connect();
		return () => store.disconnect();
	});
</script>

<svelte:head>
	<title>Chat — Martol</title>
</svelte:head>

<main class="flex h-dvh flex-col" aria-label="Chat room: {roomName}">
	<ConnectionBanner status={store.ws.status} reconnectAttempt={store.ws.reconnectAttempt} />
	<ChatHeader roomName={roomName} onlineCount={store.onlineUsers.size} />

	<MessageList
		messages={store.messages}
		systemEvents={store.systemEvents}
		loading={store.ws.status === 'connecting'}
		onRetry={(localId) => store.retrySend(localId)}
	/>

	<ChatInput
		onSend={(body) => store.sendMessage(body)}
		onTyping={() => store.notifyTyping()}
		disabled={store.ws.status !== 'connected'}
		typingNames={store.typingNames}
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
				aria-label="Dismiss error"
			>
				Dismiss
			</button>
		</div>
	{/if}
</main>
