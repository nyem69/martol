import { describe, it, expect } from 'vitest';
import type {
	ClientMessage,
	ServerMessage,
	ServerMessagePayload,
	StoredMessage,
	ErrorCode
} from './ws';

/**
 * Type-level integration tests — verify the WebSocket protocol types
 * are correctly structured and can be used for JSON serialization.
 */

describe('WebSocket protocol types', () => {
	describe('ClientMessage', () => {
		it('validates message type', () => {
			const msg: ClientMessage = {
				type: 'message',
				body: 'Hello world',
				localId: 'abc123'
			};
			expect(msg.type).toBe('message');
			expect(msg.body).toBe('Hello world');
			expect(msg.localId).toBe('abc123');
		});

		it('validates message with replyTo', () => {
			const msg: ClientMessage = {
				type: 'message',
				body: 'Reply',
				localId: 'def456',
				replyTo: 42
			};
			expect(msg.replyTo).toBe(42);
		});

		it('validates typing type', () => {
			const msg: ClientMessage = { type: 'typing', active: true };
			expect(msg.type).toBe('typing');
			expect(msg.active).toBe(true);
		});

		it('validates read type', () => {
			const msg: ClientMessage = { type: 'read', lastReadId: 100 };
			expect(msg.type).toBe('read');
			expect(msg.lastReadId).toBe(100);
		});

		it('round-trips through JSON', () => {
			const original: ClientMessage = {
				type: 'message',
				body: 'Test **bold**',
				localId: 'test-id-123'
			};
			const json = JSON.stringify(original);
			const parsed = JSON.parse(json);
			expect(parsed).toEqual(original);
		});
	});

	describe('ServerMessage', () => {
		it('validates message type with payload', () => {
			const payload: ServerMessagePayload = {
				localId: 'abc123',
				serverSeqId: 1,
				senderId: 'user-1',
				senderRole: 'owner',
				senderName: 'Alice',
				body: 'Hello',
				timestamp: '2025-01-01T00:00:00Z'
			};
			const msg: ServerMessage = { type: 'message', message: payload };
			expect(msg.type).toBe('message');
		});

		it('validates history type', () => {
			const msg: ServerMessage = { type: 'history', messages: [] };
			expect(msg.messages).toEqual([]);
		});

		it('validates presence type', () => {
			const msg: ServerMessage = {
				type: 'presence',
				senderId: 'user-1',
				senderName: 'Alice',
				status: 'online'
			};
			expect(msg.status).toBe('online');
		});

		it('validates typing type', () => {
			const msg: ServerMessage = {
				type: 'typing',
				senderId: 'user-1',
				senderName: 'Alice',
				active: true
			};
			expect(msg.active).toBe(true);
		});

		it('validates id_map type', () => {
			const msg: ServerMessage = {
				type: 'id_map',
				mappings: [{ localId: 'abc', dbId: 1 }]
			};
			expect(msg.mappings).toHaveLength(1);
		});

		it('validates error type', () => {
			const msg: ServerMessage = {
				type: 'error',
				code: 'rate_limited',
				message: 'Too many messages'
			};
			expect(msg.code).toBe('rate_limited');
		});
	});

	describe('StoredMessage', () => {
		it('has all required fields', () => {
			const stored: StoredMessage = {
				localId: 'abc',
				orgId: 'org-1',
				senderId: 'user-1',
				senderRole: 'owner',
				senderName: 'Alice',
				body: 'Hello',
				timestamp: '2025-01-01T00:00:00Z',
				flushed: false
			};
			expect(stored.flushed).toBe(false);
			expect(stored.dbId).toBeUndefined();
		});

		it('supports optional dbId', () => {
			const stored: StoredMessage = {
				localId: 'abc',
				orgId: 'org-1',
				senderId: 'user-1',
				senderRole: 'owner',
				senderName: 'Alice',
				body: 'Hello',
				timestamp: '2025-01-01T00:00:00Z',
				flushed: true,
				dbId: 42
			};
			expect(stored.dbId).toBe(42);
		});
	});

	describe('ErrorCode', () => {
		it('includes expected error codes', () => {
			const codes: ErrorCode[] = [
				'rate_limited',
				'room_full',
				'invalid_message',
				'unauthorized',
				'degraded',
				'internal'
			];
			expect(codes).toHaveLength(6);
		});
	});
});
