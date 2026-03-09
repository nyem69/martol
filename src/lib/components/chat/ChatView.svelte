<script lang="ts">
	import { onMount } from 'svelte';
	import { MessagesStore, type DisplayMessage } from '$lib/stores/messages.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { PendingAction } from '$lib/types/chat';
	import ConnectionBanner from './ConnectionBanner.svelte';
	import ChatHeader from './ChatHeader.svelte';
	import MessageList from './MessageList.svelte';
	import ChatInput from './ChatInput.svelte';
	import MemberPanel from './MemberPanel.svelte';
	import AIDisclosureModal from './AIDisclosureModal.svelte';
	import ReportModal from './ReportModal.svelte';
	import OnlineBar from './OnlineBar.svelte';
	import UsernamePrompt from './UsernamePrompt.svelte';
	import UpgradeModal from './UpgradeModal.svelte';

	let { data }: { data: any } = $props();

	// These values are stable for this component instance.
	// When roomId changes, the parent {#key} destroys and recreates this component.
	// svelte-ignore state_referenced_locally — intentional: {#key} guarantees fresh instance per room.
	const { roomId, userId, userName, userRole, roomName, userRooms, roomInvitations, initialMessages, hasAgents, hmacSecret, enableUploads } = data;

	// AI disclosure modal: show if room has agents and user hasn't acknowledged yet
	let showAIDisclosure = $state(false);

	// Convert DB messages to DisplayMessage format
	const dbMessages: DisplayMessage[] = initialMessages.map((msg: (typeof initialMessages)[number]) => ({
		localId: `db-${msg.dbId}`,
		dbId: msg.dbId,
		senderId: msg.senderId,
		senderName: msg.senderId === userId ? userName : (msg.senderName ?? msg.senderId),
		senderRole: msg.senderRole,
		body: msg.body,
		replyTo: msg.replyTo,
		editedAt: msg.editedAt,
		timestamp: msg.createdAt,
		pending: false,
		failed: false,
		isOwn: msg.senderId === userId
	}));

	const store = new MessagesStore(roomId, userId, userName, userRole, dbMessages);

	let memberPanelOpen = $state(false);
	let pendingMention = $state<string | null>(null);
	let replyTo = $state<{ dbId: number; senderName: string; body: string } | null>(null);
	let reportTarget = $state<{ messageId: number; messageBody: string } | null>(null);
	let recentActions = $state<PendingAction[]>([]);
	let actionsInFlight = $state(new Set<number>());
	let loadingHistory = $state(false);
	let hasMoreHistory = $state(initialMessages.length >= 50);
	let uploading = $state(false);
	let uploadFilename = $state('');
	let showUpgradeModal = $state(false);
	let upgradeWasCanceled = $state(false);

	// [I11] All members see action cards; only owner/lead get approve/reject buttons
	const canApproveActions = userRole === 'owner' || userRole === 'lead';

	async function loadRecentActions() {
		try {
			const res = await fetch('/api/actions?status=recent');
			if (!res.ok) return;
			const json: { ok: boolean; data: Record<string, unknown>[] } = await res.json();
			if (json.ok) {
				recentActions = json.data.map((a) => ({
					id: a.id as number,
					actionType: a.action_type as string,
					riskLevel: a.risk_level as 'low' | 'medium' | 'high',
					description: a.description as string,
					requestedBy: a.requested_by as string,
					requestedRole: a.requested_role as string,
					agentName: (a.agent_user_id as string) ?? 'Agent',
					status: a.status as PendingAction['status'],
					timestamp: a.created_at as string,
				simulationType: (a.simulation_type as string) ?? null,
				simulationPayload: (a.simulation_payload as Record<string, unknown>) ?? null,
				riskFactors: (a.risk_factors as { factor: string; severity: string; detail: string }[]) ?? null,
				estimatedImpact: (a.estimated_impact as { files_modified?: number; services_affected?: string[]; reversible?: boolean }) ?? null
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
				editedAt: (msg.edited_at as string) ?? undefined,
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

	// [I1] Route approve/reject through DO WebSocket for real-time broadcast to all clients
	function handleApproveAction(actionId: number) {
		if (actionsInFlight.has(actionId)) return;
		actionsInFlight = new Set([...actionsInFlight, actionId]);
		// Optimistic update
		recentActions = recentActions.map((a) =>
			a.id === actionId ? { ...a, status: 'approved' as const } : a
		);
		store.ws.send({ type: 'command', name: 'approve', args: String(actionId) });
		// Refresh after DO processes — clears in-flight and syncs true state
		setTimeout(async () => {
			await loadRecentActions();
			actionsInFlight = new Set([...actionsInFlight].filter((id) => id !== actionId));
		}, 1000);
	}

	function handleRejectAction(actionId: number) {
		if (actionsInFlight.has(actionId)) return;
		actionsInFlight = new Set([...actionsInFlight, actionId]);
		// Optimistic update
		recentActions = recentActions.map((a) =>
			a.id === actionId ? { ...a, status: 'rejected' as const } : a
		);
		store.ws.send({ type: 'command', name: 'reject', args: String(actionId) });
		// Refresh after DO processes — clears in-flight and syncs true state
		setTimeout(async () => {
			await loadRecentActions();
			actionsInFlight = new Set([...actionsInFlight].filter((id) => id !== actionId));
		}, 1000);
	}

	function handleCommand(command: string, args: string) {
		// Send as distinct command type — not broadcast as chat text
		store.ws.send({ type: 'command', name: command, args });
		// Refresh actions after approve/reject command
		if (command === 'approve' || command === 'reject') {
			setTimeout(() => loadRecentActions(), 500);
		}
	}

	function handleReply(message: DisplayMessage) {
		if (!message.dbId) return;
		replyTo = { dbId: message.dbId, senderName: message.senderName, body: message.body };
	}

	function handleReport(messageId: number, messageBody: string) {
		reportTarget = { messageId, messageBody };
	}

	const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
	const MAX_FILE_SIZE = 10 * 1024 * 1024;

	async function handleUploadImage(file: File) {
		if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
			store.error = m.upload_error_type();
			return;
		}
		if (file.size > MAX_FILE_SIZE) {
			store.error = m.upload_error_size();
			return;
		}

		// Check quota before uploading
		try {
			const quotaRes = await fetch('/api/upload/quota');
			if (quotaRes.ok) {
				const quota = (await quotaRes.json()) as { canUpload: boolean; canceled?: boolean };
				if (!quota.canUpload) {
					upgradeWasCanceled = quota.canceled ?? false;
					showUpgradeModal = true;
					return;
				}
			}
		} catch {
			// Non-critical — server will enforce quota anyway
		}

		uploadFilename = file.name;
		uploading = true;

		try {
			const formData = new FormData();
			formData.append('file', file);

			const res = await fetch('/api/upload', { method: 'POST', body: formData });

			if (res.status === 402) {
				uploading = false;
				uploadFilename = '';
				showUpgradeModal = true;
				return;
			}
			if (!res.ok) {
				let errMsg = 'Upload failed';
				try { const d = (await res.json()) as { message?: string }; errMsg = d?.message || errMsg; } catch {}
				store.error = errMsg;
				return;
			}

			const data = (await res.json()) as { filename: string; key: string };

			// Send as message with r2: image marker
			store.sendMessage(`![${data.filename}](r2:${data.key})`);
		} catch {
			store.error = 'Upload failed';
		} finally {
			uploading = false;
			uploadFilename = '';
		}
	}

	onMount(() => {
		store.connect();
		loadRecentActions();
		// Show AI disclosure if room has agents and user hasn't acknowledged
		if (hasAgents && !localStorage.getItem(`ai-disclosed-${roomId}`)) {
			showAIDisclosure = true;
		}
		return () => store.disconnect();
	});

	// [I3] Refresh actions when new agent messages arrive (debounced 2s)
	$effect(() => {
		const lastMsg = store.messages[store.messages.length - 1];
		if (lastMsg?.senderRole !== 'agent') return;
		const timerId = setTimeout(() => loadRecentActions(), 2000);
		return () => clearTimeout(timerId);
	});
</script>

<main class="h-dvh overflow-hidden" aria-label="Chat room: {roomName}">
	<div class="flex h-full flex-col overflow-hidden">
		<ConnectionBanner status={store.ws.status} reconnectAttempt={store.ws.reconnectAttempt} />
		<ChatHeader
			{roomName}
			{roomId}
			rooms={userRooms}
			{userName}
			{userRole}
			onlineCount={store.onlineUsers.size}
			onToggleMembers={() => (memberPanelOpen = !memberPanelOpen)}
		/>

		<OnlineBar
			onlineUsers={store.onlineUsers}
			{userId}
			onMention={(name) => (pendingMention = name)}
		/>

		<UsernamePrompt username={userName} />

		<MessageList
			messages={store.messages}
			systemEvents={store.systemEvents}
			actions={recentActions}
			{actionsInFlight}
			loading={store.ws.status === 'connecting'}
			{loadingHistory}
			{hasMoreHistory}
			{canApproveActions}
			onRetry={(localId) => store.retrySend(localId)}
			onReply={handleReply}
			onReport={handleReport}
			onLoadMore={loadMoreHistory}
			onApproveAction={handleApproveAction}
			onRejectAction={handleRejectAction}
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
			{pendingMention}
			onMentionConsumed={() => (pendingMention = null)}
			uploadEnabled={enableUploads}
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
		{userRole}
		{roomId}
		invitations={roomInvitations}
		{hmacSecret}
	/>
</main>

{#if showAIDisclosure}
	<AIDisclosureModal
		{roomId}
		onAcknowledge={() => (showAIDisclosure = false)}
	/>
{/if}

{#if reportTarget}
	<ReportModal
		messageId={reportTarget.messageId}
		messageBody={reportTarget.messageBody}
		onClose={() => (reportTarget = null)}
	/>
{/if}

{#if showUpgradeModal}
	<UpgradeModal wasCanceled={upgradeWasCanceled} onClose={() => (showUpgradeModal = false)} />
{/if}
