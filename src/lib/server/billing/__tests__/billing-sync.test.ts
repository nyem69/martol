/**
 * Tests for billing-sync: syncOrgSubscription and syncTeamSubscription.
 * Stripe is mocked via vi.mock so no real network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncOrgSubscription, syncTeamSubscription } from '$lib/server/billing-sync';
import { createStripe } from '$lib/server/stripe';
import { createMockStripeSubscription, TEST_IDS } from './helpers';

vi.mock('$lib/server/stripe', () => ({
	createStripe: vi.fn()
}));

const mockCreateStripe = vi.mocked(createStripe);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Stripe client whose subscriptions.list resolves to `data`. */
function makeStripeClient(data: any[]) {
	return {
		subscriptions: {
			list: vi.fn().mockResolvedValue({ data })
		}
	} as any;
}

/**
 * Build a chainable mock DB for billing-sync tests.
 * selectRows: what the SELECT … .limit(1) call returns (array).
 * The update chain (.update.set.where) is also fully chainable and awaitable.
 */
function makeSyncDb(selectRows: any[] = []) {
	// update chain
	const updateChain: any = {
		set: vi.fn(),
		where: vi.fn().mockResolvedValue(undefined)
	};
	updateChain.set.mockReturnValue(updateChain);

	// select chain: .select().from().where().limit() → resolves to selectRows
	const selectChain: any = {
		from: vi.fn(),
		where: vi.fn(),
		limit: vi.fn().mockResolvedValue(selectRows)
	};
	selectChain.from.mockReturnValue(selectChain);
	selectChain.where.mockReturnValue(selectChain);

	const db: any = {
		select: vi.fn().mockReturnValue(selectChain),
		update: vi.fn().mockReturnValue(updateChain),
		// Expose sub-chains for assertions
		_updateChain: updateChain,
		_selectChain: selectChain
	};

	return db;
}

// ---------------------------------------------------------------------------
// syncOrgSubscription
// ---------------------------------------------------------------------------

describe('syncOrgSubscription', () => {
	const STRIPE_KEY = 'sk_test_fake';
	const ORG_ID = TEST_IDS.PRO_ORG;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('updates DB when Stripe status differs from DB status', async () => {
		// DB says 'active', Stripe says 'canceled'
		const dbSubRow = {
			id: 'sub-row-1',
			stripeCustomerId: 'cus_test_123',
			stripeSubscriptionId: 'sub_test_123',
			status: 'active',
			cancelAtPeriodEnd: false
		};
		const db = makeSyncDb([dbSubRow]);

		const stripeSub = createMockStripeSubscription({ status: 'canceled' });
		mockCreateStripe.mockReturnValue(makeStripeClient([stripeSub]));

		const result = await syncOrgSubscription(db, ORG_ID, STRIPE_KEY);

		expect(result).toBe(true);
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'canceled' })
		);
	});

	it('does not call db.update when status already matches Stripe', async () => {
		// DB and Stripe both say 'active', same sub id, same cancelAtPeriodEnd
		const stripeSub = createMockStripeSubscription({ id: 'sub_test_123', status: 'active' });
		const dbSubRow = {
			id: 'sub-row-1',
			stripeCustomerId: 'cus_test_123',
			stripeSubscriptionId: stripeSub.id,
			status: 'active',
			cancelAtPeriodEnd: false
		};
		const db = makeSyncDb([dbSubRow]);

		mockCreateStripe.mockReturnValue(makeStripeClient([stripeSub]));

		const result = await syncOrgSubscription(db, ORG_ID, STRIPE_KEY);

		expect(result).toBe(true);
		// update() must NOT have been called because nothing changed
		expect(db.update).not.toHaveBeenCalled();
	});

	it('returns true (early) when no subscription record exists in DB', async () => {
		// DB returns empty array — no sub row
		const db = makeSyncDb([]);

		const result = await syncOrgSubscription(db, ORG_ID, STRIPE_KEY);

		expect(result).toBe(true);
		// Stripe should never be called
		expect(mockCreateStripe).not.toHaveBeenCalled();
	});

	it('returns true (early) when subscription row has no stripeCustomerId', async () => {
		const dbSubRow = {
			id: 'sub-row-1',
			stripeCustomerId: null,
			stripeSubscriptionId: null,
			status: 'active',
			cancelAtPeriodEnd: false
		};
		const db = makeSyncDb([dbSubRow]);

		const result = await syncOrgSubscription(db, ORG_ID, STRIPE_KEY);

		expect(result).toBe(true);
		expect(mockCreateStripe).not.toHaveBeenCalled();
	});

	it('returns false when Stripe API throws an error', async () => {
		const dbSubRow = {
			id: 'sub-row-1',
			stripeCustomerId: 'cus_test_123',
			stripeSubscriptionId: 'sub_test_123',
			status: 'active',
			cancelAtPeriodEnd: false
		};
		const db = makeSyncDb([dbSubRow]);

		mockCreateStripe.mockReturnValue({
			subscriptions: {
				list: vi.fn().mockRejectedValue(new Error('Stripe API unreachable'))
			}
		} as any);

		const result = await syncOrgSubscription(db, ORG_ID, STRIPE_KEY);

		expect(result).toBe(false);
		expect(db.update).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// syncTeamSubscription
// ---------------------------------------------------------------------------

describe('syncTeamSubscription', () => {
	const STRIPE_KEY = 'sk_test_fake';
	const TEAM_ID = TEST_IDS.TEAM_ID;
	const STRIPE_CUSTOMER_ID = 'cus_team_123';

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('updates seats and period from Stripe data', async () => {
		const db = makeSyncDb();

		const stripeSub = createMockStripeSubscription({ quantity: 5, status: 'active' });
		mockCreateStripe.mockReturnValue(makeStripeClient([stripeSub]));

		const result = await syncTeamSubscription(db, TEAM_ID, STRIPE_CUSTOMER_ID, STRIPE_KEY);

		expect(result).toBe(true);
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				seats: 5,
				status: 'active'
			})
		);
	});

	it('returns false when Stripe API throws an error', async () => {
		const db = makeSyncDb();

		mockCreateStripe.mockReturnValue({
			subscriptions: {
				list: vi.fn().mockRejectedValue(new Error('Stripe rate limit'))
			}
		} as any);

		const result = await syncTeamSubscription(db, TEAM_ID, STRIPE_CUSTOMER_ID, STRIPE_KEY);

		expect(result).toBe(false);
		expect(db.update).not.toHaveBeenCalled();
	});
});
