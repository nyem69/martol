import { describe, it, expect, vi } from 'vitest';
import { actionSubmit } from './action-submit';
import type { AgentContext } from '../auth';

/**
 * Unit tests for server-side action gating.
 * Verifies the risk matrix, cursor validation, and role-based approval.
 */

function mockAgent(overrides?: Partial<AgentContext>): AgentContext {
	return {
		agentUserId: 'agent-1',
		agentName: 'claude:backend',
		orgId: 'org-1',
		orgRole: 'agent',
		isAdmin: false,
		...overrides
	};
}

// Build a mock DB chain that responds to sequential calls
function createMockDb(opts: {
	triggerMessage?: { id: number; senderId: string; senderRole: string; orgId: string } | null;
	cursor?: { lastReadId: number } | null;
	memberRecord?: { role: string } | null;
	insertedAction?: { id: number } | null;
}) {
	let callCount = 0;

	const chain = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		limit: vi.fn().mockImplementation(() => {
			callCount++;
			// 1st query: trigger message lookup
			if (callCount === 1) return Promise.resolve(opts.triggerMessage ? [opts.triggerMessage] : []);
			// 2nd query: cursor lookup
			if (callCount === 2) return Promise.resolve(opts.cursor ? [opts.cursor] : []);
			// 3rd query: member lookup
			if (callCount === 3) return Promise.resolve(opts.memberRecord ? [opts.memberRecord] : []);
			return Promise.resolve([]);
		}),
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		returning: vi.fn().mockResolvedValue(
			opts.insertedAction ? [opts.insertedAction] : [{ id: 1 }]
		)
	};
	return chain;
}

describe('actionSubmit', () => {
	// ── Trigger message validation ──────────────────────────────

	it('rejects when trigger message not found', async () => {
		const db = createMockDb({ triggerMessage: null, cursor: null, memberRecord: null });
		const result = await actionSubmit(
			{ action_type: 'code_review', risk_level: 'low', trigger_message_id: 999, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('invalid_trigger');
	});

	// ── Cursor validation ───────────────────────────────────────

	it('rejects when agent cursor is behind trigger message', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'owner', orgId: 'org-1' },
			cursor: { lastReadId: 5 },
			memberRecord: null
		});
		const result = await actionSubmit(
			{ action_type: 'code_review', risk_level: 'low', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('cursor_behind');
	});

	it('rejects when agent has no cursor at all', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'owner', orgId: 'org-1' },
			cursor: null,
			memberRecord: null
		});
		const result = await actionSubmit(
			{ action_type: 'code_review', risk_level: 'low', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('cursor_behind');
	});

	// ── Member validation ───────────────────────────────────────

	it('rejects when triggering user is no longer a member', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'owner', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: null
		});
		const result = await actionSubmit(
			{ action_type: 'code_review', risk_level: 'low', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('sender_removed');
	});

	// ── Risk matrix: low risk ───────────────────────────────────

	it('approves low-risk actions directly for any role', async () => {
		for (const senderRole of ['owner', 'lead', 'member']) {
			const db = createMockDb({
				triggerMessage: { id: 10, senderId: 'user-1', senderRole, orgId: 'org-1' },
				cursor: { lastReadId: 10 },
				memberRecord: { role: senderRole },
				insertedAction: { id: 42 }
			});
			const result = await actionSubmit(
				{ action_type: 'question_answer', risk_level: 'low', trigger_message_id: 10, description: 'test' },
				mockAgent(),
				db
			);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.data.status).toBe('approved');
		}
	});

	it('rejects low-risk actions from viewer', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'viewer', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'viewer' }
		});
		const result = await actionSubmit(
			{ action_type: 'question_answer', risk_level: 'low', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('action_rejected');
	});

	// ── Risk matrix: medium risk ────────────────────────────────

	it('approves medium-risk code_write directly for owner', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'owner', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'owner' },
			insertedAction: { id: 43 }
		});
		const result = await actionSubmit(
			{ action_type: 'code_write', risk_level: 'medium', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.status).toBe('approved');
	});

	it('approves medium-risk code_write directly for lead', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'lead', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'lead' },
			insertedAction: { id: 44 }
		});
		const result = await actionSubmit(
			{ action_type: 'code_write', risk_level: 'medium', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.status).toBe('approved');
	});

	it('creates pending action for medium-risk code_write from member', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'member', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'member' },
			insertedAction: { id: 45 }
		});
		const result = await actionSubmit(
			{ action_type: 'code_write', risk_level: 'medium', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.status).toBe('pending');
	});

	// ── Risk matrix: high risk ──────────────────────────────────

	it('approves high-risk code_modify directly for owner', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'owner', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'owner' },
			insertedAction: { id: 46 }
		});
		const result = await actionSubmit(
			{ action_type: 'code_modify', risk_level: 'high', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.status).toBe('approved');
	});

	it('creates pending action for high-risk code_modify from lead', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'lead', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'lead' },
			insertedAction: { id: 47 }
		});
		const result = await actionSubmit(
			{ action_type: 'code_modify', risk_level: 'high', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.status).toBe('pending');
	});

	it('rejects high-risk code_delete from member', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'member', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'member' }
		});
		const result = await actionSubmit(
			{ action_type: 'code_delete', risk_level: 'high', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('action_rejected');
	});

	it('rejects high-risk deploy from member', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'member', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'member' }
		});
		const result = await actionSubmit(
			{ action_type: 'deploy', risk_level: 'high', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('action_rejected');
	});

	it('creates pending action for high-risk code_modify from member', async () => {
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'member', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'member' },
			insertedAction: { id: 48 }
		});
		const result = await actionSubmit(
			{ action_type: 'code_modify', risk_level: 'high', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.status).toBe('pending');
	});

	// ── Server-derived risk level ───────────────────────────────

	it('uses server-derived risk level regardless of agent claim', async () => {
		// Agent claims low, but code_modify is high on server
		const db = createMockDb({
			triggerMessage: { id: 10, senderId: 'user-1', senderRole: 'lead', orgId: 'org-1' },
			cursor: { lastReadId: 10 },
			memberRecord: { role: 'lead' },
			insertedAction: { id: 49 }
		});
		const result = await actionSubmit(
			{ action_type: 'code_modify', risk_level: 'low', trigger_message_id: 10, description: 'test' },
			mockAgent(),
			db
		);
		// Should be pending (high risk for lead), not approved (if low was trusted)
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.status).toBe('pending');
	});
});
