<script lang="ts">
	import { onMount } from 'svelte';
	import { MessagesStore, type DisplayMessage } from '$lib/stores/messages.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { PendingAction } from '$lib/types/chat';
	import ConnectionBanner from '$lib/components/chat/ConnectionBanner.svelte';
	import ChatHeader from '$lib/components/chat/ChatHeader.svelte';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';
	import MemberPanel from '$lib/components/chat/MemberPanel.svelte';
	import PendingActionLine from '$lib/components/chat/PendingActionLine.svelte';

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
	let pendingActions = $state<PendingAction[]>([]);
	let loadingHistory = $state(false);
	let hasMoreHistory = $state(initialMessages.length >= 50);

	const canViewActions = userRole === 'owner' || userRole === 'lead';
	const canApproveActions = userRole === 'owner' || userRole === 'lead';

	async function loadPendingActions() {
		if (!canViewActions) return;
		try {
			const res = await fetch('/api/actions?status=pending');
			if (!res.ok) return;
			const json: { ok: boolean; data: Record<string, unknown>[] } = await res.json();
			if (json.ok) {
				pendingActions = json.data.map((a) => ({
					id: a.id as number,
					actionType: a.action_type as string,
					riskLevel: a.risk_level as 'low' | 'medium' | 'high',
					description: a.description as string,
					requestedBy: a.requested_by as string,
					requestedRole: a.requested_role as string,
					agentName: (a.agent_user_id as string) ?? 'Agent',
					status: a.status as PendingAction['status'],
					timestamp: a.created_at as string
				}));
			}
		} catch {
			// Non-critical — actions still accessible via /actions command
		}
	}

	async function loadMoreHistory() {
		if (loadingHistory || !hasMoreHistory) return;
		// Find the oldest message with a dbId (DB messages have them, WS-only don't)
		const oldestDb = store.messages.find((m) => m.dbId !== undefined);
		if (!oldestDb?.dbId) {
			hasMoreHistory = false;
			return;
		}

		loadingHistory = true;
		try {
			const res = await fetch(`/api/messages?before=${oldestDb.dbId}&limit=50`);
			if (!res.ok) return;
			const json: { ok: boolean; data: Record<string, unknown>[]; has_more: boolean } = await res.json();
			if (!json.ok || json.data.length === 0) {
				hasMoreHistory = false;
				return;
			}

			hasMoreHistory = json.has_more;

			const olderMessages: DisplayMessage[] = json.data.map((msg) => ({
				localId: `db-${msg.id}`,
				dbId: msg.id as number,
				senderId: msg.sender_id as string,
				senderName: (msg.sender_id as string) === userId ? userName : ((msg.sender_name as string) ?? (msg.sender_id as string)),
				senderRole: msg.sender_role as string,
				body: msg.body as string,
				timestamp: msg.created_at as string,
				pending: false,
				failed: false,
				isOwn: (msg.sender_id as string) === userId
			}));

			// Prepend older messages
			store.messages = [...olderMessages, ...store.messages];
		} catch {
			// Non-critical failure
		} finally {
			loadingHistory = false;
		}
	}

	async function handleApproveAction(actionId: number) {
		try {
			const res = await fetch(`/api/actions/${actionId}/approve`, { method: 'POST' });
			if (res.ok) await loadPendingActions();
		} catch { /* handled by reload */ }
	}

	async function handleRejectAction(actionId: number) {
		try {
			const res = await fetch(`/api/actions/${actionId}/reject`, { method: 'POST' });
			if (res.ok) await loadPendingActions();
		} catch { /* handled by reload */ }
	}

	function handleCommand(command: string, args: string) {
		// Send as distinct command type — not broadcast as chat text
		store.ws.send({ type: 'command', name: command, args });
		// Refresh actions after approve/reject command
		if (command === 'approve' || command === 'reject') {
			setTimeout(() => loadPendingActions(), 500);
		}
	}

	function handleReply(message: DisplayMessage) {
		if (!message.dbId) return;
		replyTo = { dbId: message.dbId, senderName: message.senderName, body: message.body };
	}

	onMount(() => {
		store.connect();
		loadPendingActions();
		return () => store.disconnect();
	});
</script>

<svelte:head>
	<title>Chat — Martol</title>
</svelte:head>

<main class="h-dvh overflow-hidden" aria-label="Chat room: {roomName}">
	<div class="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
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
			{loadingHistory}
			{hasMoreHistory}
			onRetry={(localId) => store.retrySend(localId)}
			onReply={handleReply}
			onLoadMore={loadMoreHistory}
		/>

		{#if pendingActions.length > 0}
			<div class="shrink-0 border-t" style="border-color: var(--border); background: var(--bg-surface);">
				{#each pendingActions as action (action.id)}
					<PendingActionLine
						{action}
						canApprove={canApproveActions}
						onApprove={handleApproveAction}
						onReject={handleRejectAction}
					/>
				{/each}
			</div>
		{/if}

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
