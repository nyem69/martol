/**
 * Messages Store — Martol
 *
 * Higher-level store consuming WebSocket events, exposing reactive chat state.
 * Manages messages, typing indicators, presence, and outbound typing throttle.
 */

import type { ServerMessage, ServerMessagePayload } from '$lib/types/ws';
import { SvelteMap } from 'svelte/reactivity';
import { WebSocketStore } from './websocket.svelte';

const MAX_SYSTEM_EVENTS = 100;
const PENDING_TIMEOUT_MS = 15_000;

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
	failed: boolean;
	isOwn: boolean;
}

export interface SystemEvent {
	id: string;
	type: 'join' | 'leave' | 'clear';
	name: string;
	timestamp: string;
}

export class MessagesStore {
	messages = $state<DisplayMessage[]>([]);
	typingUsers = $state(new SvelteMap<string, { name: string; timeout: ReturnType<typeof setTimeout> }>());
	onlineUsers = $state(new SvelteMap<string, string>());
	lastServerSeqId = $state(0);
	systemEvents = $state<SystemEvent[]>([]);
	error = $state<string | null>(null);

	readonly ws: WebSocketStore;

	private readonly userId: string;
	private readonly userName: string;
	private readonly userRole: string;
	private lastTypingSent = 0;
	private typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private systemEventCounter = 0;

	constructor(
		roomId: string,
		userId: string,
		userName: string,
		userRole: string,
		initialMessages?: DisplayMessage[]
	) {
		this.userId = userId;
		this.userName = userName;
		this.userRole = userRole;

		if (initialMessages && initialMessages.length > 0) {
			this.messages = initialMessages;
			// Set lastServerSeqId from initial messages
			for (const msg of initialMessages) {
				if (msg.serverSeqId && msg.serverSeqId > this.lastServerSeqId) {
					this.lastServerSeqId = msg.serverSeqId;
				}
			}
		}

		this.ws = new WebSocketStore(
			roomId,
			this.lastServerSeqId,
			(msg) => this.handleServerMessage(msg),
			() => this.retryPendingMessages()
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
			case 'clear':
				this.handleClear(msg.clearedBy);
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
			failed: false,
			isOwn: payload.senderId === this.userId
		};

		if (existingIdx !== -1) {
			// Clear pending timer
			this.clearPendingTimer(payload.localId);
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
		const existingByLocalId = new Map(this.messages.map((m, i) => [m.localId, i]));

		const newMessages: DisplayMessage[] = [];

		for (const p of payloads) {
			const existingIdx = existingByLocalId.get(p.localId);
			if (existingIdx !== undefined) {
				// Reconcile: update pending message to confirmed state
				const existing = this.messages[existingIdx];
				if (existing.pending) {
					this.clearPendingTimer(p.localId);
					this.messages[existingIdx] = {
						...existing,
						serverSeqId: p.serverSeqId,
						senderRole: p.senderRole,
						pending: false,
						failed: false
					};
				}
			} else {
				newMessages.push({
					localId: p.localId,
					serverSeqId: p.serverSeqId,
					senderId: p.senderId,
					senderName: p.senderName,
					senderRole: p.senderRole,
					body: p.body,
					timestamp: p.timestamp,
					pending: false,
					failed: false,
					isOwn: p.senderId === this.userId
				});
			}
		}

		if (newMessages.length > 0) {
			// Merge and sort — pending messages (no serverSeqId) go to the end
			this.messages = [...newMessages, ...this.messages].sort(
				(a, b) => (a.serverSeqId ?? Infinity) - (b.serverSeqId ?? Infinity)
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
			}, 4000);

			this.typingUsers.set(senderId, { name: senderName, timeout });
		} else {
			const existing = this.typingUsers.get(senderId);
			if (existing) clearTimeout(existing.timeout);
			this.typingUsers.delete(senderId);
		}
	}

	private handlePresence(senderId: string, senderName: string, status: 'online' | 'offline'): void {
		if (status === 'online') {
			this.onlineUsers.set(senderId, senderName);
			this.addSystemEvent('join', senderName);
		} else {
			this.onlineUsers.delete(senderId);
			// Clear typing state on disconnect
			const existing = this.typingUsers.get(senderId);
			if (existing) {
				clearTimeout(existing.timeout);
				this.typingUsers.delete(senderId);
			}
			this.addSystemEvent('leave', senderName);
		}
	}

	private handleClear(clearedBy: string): void {
		this.messages = [];
		// Clear all pending timers
		for (const timer of this.pendingTimers.values()) {
			clearTimeout(timer);
		}
		this.pendingTimers.clear();
		this.addSystemEvent('clear', clearedBy);
	}

	private addSystemEvent(type: 'join' | 'leave' | 'clear', name: string): void {
		this.systemEvents.push({
			id: `sys-${++this.systemEventCounter}`,
			type,
			name,
			timestamp: new Date().toISOString()
		});
		// Cap to prevent unbounded growth
		if (this.systemEvents.length > MAX_SYSTEM_EVENTS) {
			this.systemEvents = this.systemEvents.slice(-MAX_SYSTEM_EVENTS);
		}
	}

	// ── Pending message management ──────────────────────────────────────

	private startPendingTimer(localId: string): void {
		const timer = setTimeout(() => {
			this.pendingTimers.delete(localId);
			const msg = this.messages.find((m) => m.localId === localId);
			if (msg && msg.pending) {
				msg.failed = true;
				msg.pending = false;
			}
		}, PENDING_TIMEOUT_MS);
		this.pendingTimers.set(localId, timer);
	}

	private clearPendingTimer(localId: string): void {
		const timer = this.pendingTimers.get(localId);
		if (timer) {
			clearTimeout(timer);
			this.pendingTimers.delete(localId);
		}
	}

	/** Retry pending messages after reconnection */
	private retryPendingMessages(): void {
		for (const msg of this.messages) {
			if (msg.pending && !msg.failed && msg.isOwn) {
				const sent = this.ws.send({ type: 'message', body: msg.body, localId: msg.localId });
				if (sent) {
					// Reset the timer
					this.clearPendingTimer(msg.localId);
					this.startPendingTimer(msg.localId);
				}
			}
		}
	}

	// ── Public API ──────────────────────────────────────────────────────

	sendMessage(body: string, replyTo?: number): void {
		const localId = crypto.randomUUID().replace(/-/g, '');

		const pending: DisplayMessage = {
			localId,
			senderId: this.userId,
			senderName: this.userName,
			senderRole: this.userRole,
			body,
			timestamp: new Date().toISOString(),
			pending: true,
			failed: false,
			isOwn: true
		};

		this.messages.push(pending);

		const sent = this.ws.send({ type: 'message', body, localId, ...(replyTo ? { replyTo } : {}) });
		if (sent) {
			this.startPendingTimer(localId);
		} else {
			// Will be retried on reconnect
		}

		// Clear typing state after sending
		this.sendTypingInactive();
	}

	/** Retry a failed message */
	retrySend(localId: string): void {
		const msg = this.messages.find((m) => m.localId === localId);
		if (!msg || !msg.failed) return;

		msg.failed = false;
		msg.pending = true;
		const sent = this.ws.send({ type: 'message', body: msg.body, localId: msg.localId });
		if (sent) {
			this.startPendingTimer(localId);
		}
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

	typingNames = $derived([...this.typingUsers.values()].map((t) => t.name).sort());

	connect(): void {
		this.ws.connect();
	}

	disconnect(): void {
		this.ws.disconnect();
		// Clear all typing timeouts
		for (const entry of this.typingUsers.values()) {
			clearTimeout(entry.timeout);
		}
		// Clear all pending timers
		for (const timer of this.pendingTimers.values()) {
			clearTimeout(timer);
		}
		this.pendingTimers.clear();
		if (this.typingIdleTimer) {
			clearTimeout(this.typingIdleTimer);
			this.typingIdleTimer = null;
		}
	}
}
