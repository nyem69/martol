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
	| { type: 'read'; lastReadId: number }
	| { type: 'edit'; serverSeqId: number; body: string }
	| { type: 'stream_start'; localId: string; replyTo?: number }
	| { type: 'stream_delta'; localId: string; delta: string }
	| { type: 'stream_end'; localId: string; body: string };

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
	subtype?: string;
}

export type ServerMessage =
	| { type: 'message'; message: ServerMessagePayload }
	| { type: 'typing'; senderId: string; senderName: string; active: boolean }
	| { type: 'presence'; senderId: string; senderName: string; senderRole: string; status: 'online' | 'offline' }
	| { type: 'roster'; members: Array<{ id: string; name: string; role: string }> }
	| { type: 'history'; messages: ServerMessagePayload[] }
	| { type: 'id_map'; mappings: Array<{ localId: string; serverSeqId: number; dbId: number }> }
	| { type: 'edit'; serverSeqId: number; body: string; editedAt: string; senderId: string }
	| { type: 'clear'; clearedBy: string }
	| { type: 'brief_changed'; version: number; changedBy: string }
	| { type: 'document_indexed'; attachmentId: number; filename: string; chunks: number }
	| { type: 'error'; code: ErrorCode; message: string }
	| { type: 'stream_start'; localId: string; senderId: string; senderName: string; senderRole: string; replyTo?: number; timestamp: string }
	| { type: 'stream_delta'; localId: string; delta: string }
	| { type: 'stream_abort'; localId: string; reason: string };

export type ErrorCode =
	| 'rate_limited'
	| 'room_full'
	| 'invalid_message'
	| 'unauthorized'
	| 'degraded'
	| 'internal'
	| 'resync_required';

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
	editedAt?: string;
	flushed: boolean;
	dbId?: number;
	subtype?: string;
}
