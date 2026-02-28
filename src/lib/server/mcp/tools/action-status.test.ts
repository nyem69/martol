import { describe, it, expect, vi } from 'vitest';
import { actionStatus } from './action-status';
import type { AgentContext } from '../auth';

/**
 * Unit tests for action_status MCP tool.
 */

function mockAgent(overrides?: Partial<AgentContext>): AgentContext {
	return {
		agentUserId: 'agent-1',
		agentName: 'claude:backend',
		orgId: 'org-1',
		label: 'claude:backend',
		model: 'claude-sonnet-4-6',
		orgRole: 'member',
		...overrides
	};
}

function createMockDb(result: any = null) {
	return {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue(result ? [result] : [])
	};
}

describe('actionStatus', () => {
	it('returns action details for valid action', async () => {
		const db = createMockDb({
			id: 42,
			status: 'pending',
			actionType: 'code_modify',
			riskLevel: 'high',
			description: 'Refactor auth module',
			createdAt: new Date('2026-01-15T10:00:00Z'),
			approvedBy: null,
			approvedAt: null
		});

		const result = await actionStatus({ action_id: 42 }, mockAgent(), db);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.action_id).toBe(42);
			expect(result.data.status).toBe('pending');
			expect(result.data.action_type).toBe('code_modify');
			expect(result.data.risk_level).toBe('high');
			expect(result.data.approved_by).toBeNull();
		}
	});

	it('returns approved action with approval details', async () => {
		const db = createMockDb({
			id: 43,
			status: 'approved',
			actionType: 'code_write',
			riskLevel: 'medium',
			description: 'Create new file',
			createdAt: new Date('2026-01-15T10:00:00Z'),
			approvedBy: 'user-1',
			approvedAt: new Date('2026-01-15T10:05:00Z')
		});

		const result = await actionStatus({ action_id: 43 }, mockAgent(), db);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.status).toBe('approved');
			expect(result.data.approved_by).toBe('user-1');
			expect(result.data.approved_at).toBe('2026-01-15T10:05:00.000Z');
		}
	});

	it('returns error for non-existent action', async () => {
		const db = createMockDb(null);
		const result = await actionStatus({ action_id: 999 }, mockAgent(), db);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('action_not_found');
		}
	});
});
