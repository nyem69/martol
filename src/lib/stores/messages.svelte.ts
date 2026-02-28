/**
 * Messages Store — Martol
 *
 * Higher-level store consuming WebSocket events, exposing reactive chat state.
 * Manages messages, typing indicators, presence, and outbound typing throttle.
 */

import type { ServerMessage, ServerMessagePayload } from '$lib/types/ws';
import { WebSocketStore } from './websocket.svelte';

export interface DisplayMessage {
	localId: string;
	serverSeqId?: number;
	dbId?: number;
	senderId: string;
	senderName: string;
	senderRole: string;
	body: string;
	timestamp: string;
	pending: boolean;
	isOwn: boolean;
}

export interface SystemEvent {
	type: 'join' | 'leave';
	name: string;
	timestamp: string;
}

export class MessagesStore {
	messages = $state<DisplayMessage[]>([]);
	typingUsers = $state(new Map<string, { name: string; timeout: ReturnType<typeof setTimeout> }>());
	onlineUsers = $state(new Map<string, string>());
	lastServerSeqId = $state(0);
	systemEvents = $state<SystemEvent[]>([]);
	error = $state<string | null>(null);

	ws: WebSocketStore;

	private readonly userId: string;
	private readonly userName: string;
	private lastTypingSent = 0;
	private typingIdleTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(roomId: string, userId: string, userName: string) {
		this.userId = userId;
		this.userName = userName;

		this.ws = new WebSocketStore(roomId, this.lastServerSeqId, (msg) =>
			this.handleServerMessage(msg)
		);
	}

	private handleServerMessage(msg: ServerMessage): void {
		switch (msg.type) {
			case 'message':
				this.handleMessage(msg.message);
				break;
			case 'history':
				this.handleHistory(msg.messages);
				break;
			case 'id_map':
				this.handleIdMap(msg.mappings);
				break;
			case 'typing':
				this.handleTyping(msg.senderId, msg.senderName, msg.active);
				break;
			case 'presence':
				this.handlePresence(msg.senderId, msg.senderName, msg.status);
				break;
			case 'error':
				this.error = msg.message;
				break;
		}
	}

	private handleMessage(payload: ServerMessagePayload): void {
		// Deduplicate: replace pending message with confirmed version
		const existingIdx = this.messages.findIndex((m) => m.localId === payload.localId);
		const display: DisplayMessage = {
			localId: payload.localId,
			serverSeqId: payload.serverSeqId,
			senderId: payload.senderId,
			senderName: payload.senderName,
			senderRole: payload.senderRole,
			body: payload.body,
			timestamp: payload.timestamp,
			pending: false,
			isOwn: payload.senderId === this.userId
		};

		if (existingIdx !== -1) {
			this.messages[existingIdx] = display;
		} else {
			this.messages.push(display);
		}

		if (payload.serverSeqId > this.lastServerSeqId) {
			this.lastServerSeqId = payload.serverSeqId;
			this.ws.updateLastKnownId(payload.serverSeqId);
		}
	}

	private handleHistory(payloads: ServerMessagePayload[]): void {
		const existingIds = new Set(this.messages.map((m) => m.localId));

		const newMessages: DisplayMessage[] = payloads
			.filter((p) => !existingIds.has(p.localId))
			.map((p) => ({
				localId: p.localId,
				serverSeqId: p.serverSeqId,
				senderId: p.senderId,
				senderName: p.senderName,
				senderRole: p.senderRole,
				body: p.body,
				timestamp: p.timestamp,
				pending: false,
				isOwn: p.senderId === this.userId
			}));

		if (newMessages.length > 0) {
			// Prepend history messages (they're older), then sort by serverSeqId
			this.messages = [...newMessages, ...this.messages].sort(
				(a, b) => (a.serverSeqId ?? 0) - (b.serverSeqId ?? 0)
			);
		}

		// Update lastServerSeqId from max in history
		for (const p of payloads) {
			if (p.serverSeqId > this.lastServerSeqId) {
				this.lastServerSeqId = p.serverSeqId;
				this.ws.updateLastKnownId(p.serverSeqId);
			}
		}
	}

	private handleIdMap(mappings: Array<{ localId: string; dbId: number }>): void {
		for (const { localId, dbId } of mappings) {
			const msg = this.messages.find((m) => m.localId === localId);
			if (msg) {
				msg.dbId = dbId;
			}
		}
	}

	private handleTyping(senderId: string, senderName: string, active: boolean): void {
		if (senderId === this.userId) return;

		if (active) {
			const existing = this.typingUsers.get(senderId);
			if (existing) clearTimeout(existing.timeout);

			const timeout = setTimeout(() => {
				this.typingUsers.delete(senderId);
				// Trigger reactivity
				this.typingUsers = new Map(this.typingUsers);
			}, 4000);

			this.typingUsers.set(senderId, { name: senderName, timeout });
			this.typingUsers = new Map(this.typingUsers);
		} else {
			const existing = this.typingUsers.get(senderId);
			if (existing) clearTimeout(existing.timeout);
			this.typingUsers.delete(senderId);
			this.typingUsers = new Map(this.typingUsers);
		}
	}

	private handlePresence(senderId: string, senderName: string, status: 'online' | 'offline'): void {
		if (status === 'online') {
			this.onlineUsers.set(senderId, senderName);
			this.onlineUsers = new Map(this.onlineUsers);
			this.systemEvents.push({
				type: 'join',
				name: senderName,
				timestamp: new Date().toISOString()
			});
		} else {
			this.onlineUsers.delete(senderId);
			this.onlineUsers = new Map(this.onlineUsers);
			// Clear typing state on disconnect
			const existing = this.typingUsers.get(senderId);
			if (existing) {
				clearTimeout(existing.timeout);
				this.typingUsers.delete(senderId);
				this.typingUsers = new Map(this.typingUsers);
			}
			this.systemEvents.push({
				type: 'leave',
				name: senderName,
				timestamp: new Date().toISOString()
			});
		}
	}

	// ── Public API ──────────────────────────────────────────────────────

	sendMessage(body: string): void {
		const localId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);

		const pending: DisplayMessage = {
			localId,
			senderId: this.userId,
			senderName: this.userName,
			senderRole: 'member',
			body,
			timestamp: new Date().toISOString(),
			pending: true,
			isOwn: true
		};

		this.messages.push(pending);
		this.ws.send({ type: 'message', body, localId });

		// Clear typing state after sending
		this.sendTypingInactive();
	}

	/** Call on keydown in input — throttled to once per 2s */
	notifyTyping(): void {
		const now = Date.now();
		if (now - this.lastTypingSent < 2000) return;

		this.lastTypingSent = now;
		this.ws.send({ type: 'typing', active: true });

		// Reset idle timer
		if (this.typingIdleTimer) clearTimeout(this.typingIdleTimer);
		this.typingIdleTimer = setTimeout(() => {
			this.sendTypingInactive();
		}, 3000);
	}

	private sendTypingInactive(): void {
		this.ws.send({ type: 'typing', active: false });
		this.lastTypingSent = 0;
		if (this.typingIdleTimer) {
			clearTimeout(this.typingIdleTimer);
			this.typingIdleTimer = null;
		}
	}

	get typingNames(): string[] {
		return [...this.typingUsers.values()].map((t) => t.name).sort();
	}

	connect(): void {
		this.ws.connect();
	}

	disconnect(): void {
		this.ws.disconnect();
		// Clear all typing timeouts
		for (const entry of this.typingUsers.values()) {
			clearTimeout(entry.timeout);
		}
		if (this.typingIdleTimer) {
			clearTimeout(this.typingIdleTimer);
			this.typingIdleTimer = null;
		}
	}
}
