/**
 * Shared test helpers for billing Vitest tests.
 */
import { vi } from 'vitest';

/** Test user IDs (match seed script) */
export const TEST_IDS = {
	FREE_USER: 'test-free-0000-0000-000000000001',
	PRO_USER: 'test-pro-0000-0000-000000000002',
	FOUNDER_USER: 'test-found-000-0000-000000000003',
	TEAM_OWNER: 'test-owner-000-0000-000000000004',
	TEAM_MEMBER: 'test-member-00-0000-000000000005',
	CANCELED_USER: 'test-cancel-00-0000-000000000006',
	PASTDUE_USER: 'test-pastdue-0-0000-000000000007',
	FREE_ORG: 'org-test-free-0000-0000-000000000001',
	PRO_ORG: 'org-test-pro-0000-0000-000000000002',
	FOUNDER_ORG: 'org-test-found-000-0000-000000000003',
	TEAM_OWNER_ORG: 'org-test-owner-000-0000-000000000004',
	TEAM_ID: 'test-team-0000-0000-000000000001'
} as const;

/**
 * Create a chainable mock DB.
 * Pass `results` keyed by operation or table to control return values.
 * Default: all queries return empty arrays.
 */
export function createMockDb(defaultResults: any[] = []) {
	const chain: any = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		innerJoin: vi.fn().mockReturnThis(),
		groupBy: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue(defaultResults),
		returning: vi.fn().mockResolvedValue([]),
		onConflictDoUpdate: vi.fn().mockReturnThis(),
		onConflictDoNothing: vi.fn().mockReturnThis(),
		execute: vi.fn().mockResolvedValue([]),
		transaction: vi.fn().mockImplementation(async (fn: Function) => fn(chain))
	};
	return chain;
}

/**
 * Create a mock Stripe Checkout Session object.
 */
export function createMockCheckoutSession(overrides: Record<string, any> = {}) {
	return {
		id: 'cs_test_123',
		mode: 'subscription',
		payment_status: 'paid',
		customer: 'cus_test_123',
		subscription: {
			id: 'sub_test_123',
			status: 'active',
			cancel_at_period_end: false,
			items: {
				data: [{
					quantity: 1,
					current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
				}]
			}
		},
		metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG },
		...overrides
	};
}

/**
 * Create a mock Stripe subscription object.
 */
export function createMockStripeSubscription(overrides: Record<string, any> = {}) {
	return {
		id: 'sub_test_123',
		status: 'active',
		cancel_at_period_end: false,
		items: {
			data: [{
				quantity: overrides.quantity ?? 1,
				current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
			}]
		},
		metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG },
		...overrides
	};
}
