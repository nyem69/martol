/**
 * WebSocket Protocol Types — Martol ChatRoom
 *
 * Shared types for client ↔ server WebSocket communication.
 * Used by the ChatRoom Durable Object and client-side stores.
 */

// ── Client → Server ─────────────────────────────────────────────────

export type ClientMessage =
	| { type: 'message'; body: string; replyTo?: number; localId: string }
	| { type: 'command'; name: string; args: string }
	| { type: 'typing'; active: boolean }
	| { type: 'read'; lastReadId: number };

// ── Server → Client ─────────────────────────────────────────────────

export interface ServerMessagePayload {
	localId: string;
	serverSeqId: number;
	senderId: string;
	senderRole: string;
	senderName: string;
	body: string;
	replyTo?: number;
	timestamp: string;
}

export type ServerMessage =
	| { type: 'message'; message: ServerMessagePayload }
	| { type: 'typing'; senderId: string; senderName: string; active: boolean }
	| { type: 'presence'; senderId: string; senderName: string; status: 'online' | 'offline' }
	| { type: 'history'; messages: ServerMessagePayload[] }
	| { type: 'id_map'; mappings: Array<{ localId: string; dbId: number }> }
	| { type: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
	| 'rate_limited'
	| 'room_full'
	| 'invalid_message'
	| 'unauthorized'
	| 'degraded'
	| 'internal';

// ── DO Internal ─────────────────────────────────────────────────────

export interface StoredMessage {
	localId: string;
	orgId: string;
	senderId: string;
	senderRole: string;
	senderName: string;
	body: string;
	replyTo?: number;
	timestamp: string;
	flushed: boolean;
	dbId?: number;
}
