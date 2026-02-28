/**
 * WebSocket Store — Martol
 *
 * Manages the raw WebSocket lifecycle with exponential backoff reconnection.
 * Uses Svelte 5 runes for reactive connection status.
 */

import type { ClientMessage, ServerMessage } from '$lib/types/ws';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export class WebSocketStore {
	status = $state<ConnectionStatus>('connecting');
	reconnectAttempt = $state(0);

	private ws: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly roomId: string;
	private lastKnownId: number;
	private readonly onMessage: (msg: ServerMessage) => void;

	constructor(roomId: string, lastKnownId: number, onMessage: (msg: ServerMessage) => void) {
		this.roomId = roomId;
		this.lastKnownId = lastKnownId;
		this.onMessage = onMessage;
	}

	connect(): void {
		if (this.status === 'closed') return;

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${protocol}//${window.location.host}/api/rooms/${this.roomId}/ws?lastKnownId=${this.lastKnownId}`;

		this.ws = new WebSocket(url);
		this.status = this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';

		this.ws.onopen = () => {
			this.status = 'connected';
			this.reconnectAttempt = 0;
		};

		this.ws.onmessage = (event) => {
			try {
				const msg: ServerMessage = JSON.parse(event.data);
				this.onMessage(msg);
			} catch {
				// Ignore malformed messages
			}
		};

		this.ws.onclose = () => {
			if (this.status === 'closed') return;
			this.scheduleReconnect();
		};

		this.ws.onerror = () => {
			// onclose will fire after onerror, reconnection handled there
		};
	}

	send(msg: ClientMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	/** Update the lastKnownId for reconnection delta sync */
	updateLastKnownId(id: number): void {
		if (id > this.lastKnownId) {
			this.lastKnownId = id;
		}
	}

	disconnect(): void {
		this.status = 'closed';
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.onerror = null;
			this.ws.close();
			this.ws = null;
		}
	}

	private scheduleReconnect(): void {
		this.status = 'reconnecting';
		this.reconnectAttempt++;

		const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000) + Math.random() * 1000;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}
}
