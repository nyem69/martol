<script lang="ts">
	import { MessagesStore } from '$lib/stores/messages.svelte';
	import ConnectionBanner from '$lib/components/chat/ConnectionBanner.svelte';
	import ChatHeader from '$lib/components/chat/ChatHeader.svelte';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';

	let { data } = $props();

	// These values are stable for the page lifetime (from server load)
	const { roomId, userId, userName } = data;
	const store = new MessagesStore(roomId, userId, userName);

	$effect(() => {
		store.connect();
		return () => store.disconnect();
	});
</script>

<svelte:head>
	<title>Chat — Martol</title>
</svelte:head>

<div class="flex h-dvh flex-col">
	<ConnectionBanner status={store.ws.status} reconnectAttempt={store.ws.reconnectAttempt} />
	<ChatHeader roomName="Chat" onlineCount={store.onlineUsers.size} />

	<MessageList messages={store.messages} systemEvents={store.systemEvents} />

	<ChatInput
		onSend={(body) => store.sendMessage(body)}
		onTyping={() => store.notifyTyping()}
		disabled={store.ws.status !== 'connected'}
		typingNames={store.typingNames}
	/>
</div>
