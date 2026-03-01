import { describe, it, expect, vi } from 'vitest';
import { authenticateAgent } from './auth';

/**
 * Integration tests for MCP agent authentication.
 * Tests the auth flow with mocked dependencies.
 */

// Mock DB that returns results based on expectations
function createMockDb(result: any = null) {
	const chain = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		innerJoin: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue(result ? [result] : [])
	};
	return chain;
}

describe('authenticateAgent', () => {
	it('rejects missing API key', async () => {
		const auth = { api: { verifyApiKey: vi.fn() } };
		const db = createMockDb();

		const result = await authenticateAgent(null, auth, db);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.error.code).toBe('auth_missing');
		}
	});

	it('rejects invalid API key', async () => {
		const auth = {
			api: {
				verifyApiKey: vi.fn().mockRejectedValue(new Error('Invalid'))
			}
		};
		const db = createMockDb();

		const result = await authenticateAgent('bad-key', auth, db);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.error.code).toBe('auth_invalid');
		}
	});

	it('rejects key with valid=false', async () => {
		const auth = {
			api: {
				verifyApiKey: vi.fn().mockResolvedValue({ valid: false })
			}
		};
		const db = createMockDb();

		const result = await authenticateAgent('some-key', auth, db);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.error.code).toBe('auth_invalid');
		}
	});

	it('rejects key without userId', async () => {
		const auth = {
			api: {
				verifyApiKey: vi.fn().mockResolvedValue({ valid: true, key: {} })
			}
		};
		const db = createMockDb();

		const result = await authenticateAgent('some-key', auth, db);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.error.code).toBe('auth_invalid');
		}
	});

	it('rejects revoked key via KV', async () => {
		const auth = {
			api: {
				verifyApiKey: vi.fn().mockResolvedValue({
					valid: true,
					key: { userId: 'agent-1', id: 'key-1' }
				})
			}
		};
		const db = createMockDb();
		const kv = { get: vi.fn().mockResolvedValue('true') } as unknown as KVNamespace;

		const result = await authenticateAgent('some-key', auth, db, kv);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.error.code).toBe('auth_revoked');
		}
	});

	it('rejects unbound agent', async () => {
		const auth = {
			api: {
				verifyApiKey: vi.fn().mockResolvedValue({
					valid: true,
					key: { userId: 'agent-1', id: 'key-1' }
				})
			}
		};
		const db = createMockDb(null); // No binding found
		const kv = { get: vi.fn().mockResolvedValue(null) } as unknown as KVNamespace;

		const result = await authenticateAgent('some-key', auth, db, kv);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(403);
			expect(result.error.code).toBe('agent_unbound');
		}
	});

	it('succeeds with valid key and agent membership', async () => {
		const auth = {
			api: {
				verifyApiKey: vi.fn().mockResolvedValue({
					valid: true,
					key: { userId: 'agent-1', id: 'key-1' }
				})
			}
		};
		const db = createMockDb({
			orgId: 'org-1',
			role: 'agent',
			name: 'Claude Backend'
		});
		const kv = { get: vi.fn().mockResolvedValue(null) } as unknown as KVNamespace;

		const result = await authenticateAgent('valid-key', auth, db, kv);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.agent.agentUserId).toBe('agent-1');
			expect(result.agent.agentName).toBe('Claude Backend');
			expect(result.agent.orgId).toBe('org-1');
			expect(result.agent.orgRole).toBe('agent');
		}
	});

	it('uses fallback name when user name is null', async () => {
		const auth = {
			api: {
				verifyApiKey: vi.fn().mockResolvedValue({
					valid: true,
					key: { userId: 'agent-1', id: 'key-1' }
				})
			}
		};
		const db = createMockDb({
			orgId: 'org-1',
			role: 'agent',
			name: null
		});
		const kv = { get: vi.fn().mockResolvedValue(null) } as unknown as KVNamespace;

		const result = await authenticateAgent('valid-key', auth, db, kv);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.agent.agentName).toBe('Agent-agent-');
		}
	});
});
