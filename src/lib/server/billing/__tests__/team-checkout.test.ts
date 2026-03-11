/**
 * Tests for POST /api/billing/team/checkout — Create Stripe Checkout for Team subscription
 * Mocks createStripe so no real network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../../../routes/api/billing/team/checkout/+server';
import { createStripe } from '$lib/server/stripe';
import { TEST_IDS } from './helpers';

vi.mock('$lib/server/stripe', () => ({
	createStripe: vi.fn()
}));

// Mock @sveltejs/kit error() so it throws a plain object we can inspect
vi.mock('@sveltejs/kit', async () => {
	const actual = await vi.importActual('@sveltejs/kit');
	return {
		...actual,
		error: (status: number, message: string) => {
			throw { status, body: { message } };
		}
	};
});

const mockCreateStripe = vi.mocked(createStripe);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_ENV = {
	STRIPE_SECRET_KEY: 'sk_test_fake',
	STRIPE_PRO_PRICE_ID: 'price_monthly_123'
};

/**
 * Build a mock SvelteKit request event for the team checkout handler.
 */
function makeRequestEvent(overrides: {
	user?: any;
	session?: any;
	db?: any;
	env?: Record<string, string> | null;
	body?: Record<string, unknown>;
}): any {
	const {
		user = { id: TEST_IDS.TEAM_OWNER, email: 'owner@example.com' },
		session = { activeOrganizationId: TEST_IDS.TEAM_OWNER_ORG },
		db = makeTeamCheckoutDb(),
		env = DEFAULT_ENV,
		body = { name: 'My Team', seats: 5 }
	} = overrides;

	return {
		request: new Request('http://localhost/api/billing/team/checkout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		platform: env === null ? undefined : { env },
		locals: { user, session, db },
		url: new URL('http://localhost/api/billing/team/checkout')
	};
}

/**
 * Build a mock Stripe client for team checkout tests.
 */
function makeStripeClient(overrides: {
	customerId?: string;
	checkoutUrl?: string;
} = {}) {
	return {
		customers: {
			create: vi.fn().mockResolvedValue({ id: overrides.customerId ?? 'cus_team_new_123' })
		},
		checkout: {
			sessions: {
				create: vi.fn().mockResolvedValue({ url: overrides.checkoutUrl ?? 'https://checkout.stripe.com/team-test' })
			}
		}
	} as any;
}

/**
 * Build a chainable mock DB for team checkout tests.
 *
 * Query order:
 *   1. select({id, status, stripeCustomerId}).from(teams).where(ownerId).limit(1) → existing team
 *
 * Then either:
 *   - insert(teams).values() — for new team
 *   - update(teams).set().where() — for existing team reuse
 */
function makeTeamCheckoutDb(options: {
	existingTeam?: {
		id: string;
		status: 'active' | 'past_due' | 'canceled' | 'incomplete';
		stripeCustomerId?: string;
	} | null;
} = {}) {
	const { existingTeam = null } = options;

	const limitResults: any[][] = [
		existingTeam ? [existingTeam] : []
	];

	let limitCallCount = 0;

	function makeSelectStep(): any {
		const step: any = {
			from: vi.fn(),
			where: vi.fn(),
			limit: vi.fn().mockImplementation(() => {
				const res = limitResults[limitCallCount] ?? [];
				limitCallCount++;
				return Promise.resolve(res);
			}),
			then(resolve: any, reject: any) {
				const res = limitResults[limitCallCount] ?? [];
				limitCallCount++;
				Promise.resolve(res).then(resolve, reject);
			}
		};
		step.from.mockReturnValue(step);
		step.where.mockReturnValue(step);
		return step;
	}

	const updateChain: any = {
		set: vi.fn(),
		where: vi.fn().mockResolvedValue({ rowCount: 1 })
	};
	updateChain.set.mockReturnValue(updateChain);

	const insertChain: any = {
		values: vi.fn().mockResolvedValue(undefined)
	};

	const db: any = {
		select: vi.fn().mockImplementation(() => makeSelectStep()),
		insert: vi.fn().mockReturnValue(insertChain),
		update: vi.fn().mockReturnValue(updateChain),
		_updateChain: updateChain,
		_insertChain: insertChain
	};

	return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/billing/team/checkout', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Creates team record and Stripe Checkout Session for a new team', async () => {
		const stripe = makeStripeClient({ customerId: 'cus_team_new_123' });
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeTeamCheckoutDb({ existingTeam: null });

		const event = makeRequestEvent({ db, body: { name: 'Alpha Team', seats: 5 } });
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://checkout.stripe.com/team-test' });

		// Should insert a new team record
		expect(db.insert).toHaveBeenCalled();
		expect(db._insertChain.values).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Alpha Team',
				seats: 5,
				status: 'incomplete',
				ownerId: TEST_IDS.TEAM_OWNER
			})
		);

		// Should create a Stripe customer
		expect(stripe.customers.create).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'owner@example.com',
				metadata: expect.objectContaining({ type: 'team', owner_id: TEST_IDS.TEAM_OWNER })
			})
		);

		// Should create a checkout session
		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				customer: 'cus_team_new_123',
				mode: 'subscription',
				line_items: [
					expect.objectContaining({
						price: 'price_monthly_123',
						quantity: 5
					})
				]
			})
		);
	});

	it('Reuses existing team record when status is "incomplete"', async () => {
		const stripe = makeStripeClient({ customerId: 'cus_team_reused_123' });
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeTeamCheckoutDb({
			existingTeam: {
				id: TEST_IDS.TEAM_ID,
				status: 'incomplete',
				stripeCustomerId: 'cus_existing_456'
			}
		});

		const event = makeRequestEvent({ db, body: { name: 'Beta Team', seats: 10 } });
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://checkout.stripe.com/team-test' });

		// Should NOT insert — should update instead
		expect(db.insert).not.toHaveBeenCalled();
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Beta Team',
				seats: 10,
				status: 'incomplete'
			})
		);

		// Existing customer ID is present → should NOT create a new customer
		expect(stripe.customers.create).not.toHaveBeenCalled();
	});

	it('Reuses existing team record when status is "canceled"', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeTeamCheckoutDb({
			existingTeam: {
				id: TEST_IDS.TEAM_ID,
				status: 'canceled',
				stripeCustomerId: undefined
			}
		});

		const event = makeRequestEvent({ db, body: { name: 'Gamma Team', seats: 3 } });
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://checkout.stripe.com/team-test' });

		// Reuses existing record via update
		expect(db.update).toHaveBeenCalled();
		// No existing Stripe customer → creates a new one
		expect(stripe.customers.create).toHaveBeenCalled();
	});

	it('Rejects when name is empty with 400', async () => {
		const event = makeRequestEvent({ body: { name: '', seats: 5 } });

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Rejects when name exceeds 100 characters with 400', async () => {
		const longName = 'A'.repeat(101);
		const event = makeRequestEvent({ body: { name: longName, seats: 5 } });

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Rejects when user already has an active team with 400', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeTeamCheckoutDb({
			existingTeam: {
				id: TEST_IDS.TEAM_ID,
				status: 'active',
				stripeCustomerId: 'cus_active_789'
			}
		});

		const event = makeRequestEvent({ db, body: { name: 'New Team', seats: 5 } });

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Rejects unauthenticated requests with 401', async () => {
		const event = makeRequestEvent({ user: null, session: null });

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(401);
		}
	});

	it('Rejects when DB is unavailable with 503', async () => {
		const event = makeRequestEvent({ db: null });

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});

	it('Rejects when billing not configured with 503', async () => {
		const event = makeRequestEvent({ env: { STRIPE_SECRET_KEY: 'sk_test_fake' } }); // no price ID

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});

	it('Clamps seats below 1 to 1', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeTeamCheckoutDb({ existingTeam: null });
		// Use -1 (negative) to exercise Math.max(1, ...) — seats: 0 falls back to 5 via `|| 5`
		const event = makeRequestEvent({ db, body: { name: 'Min Team', seats: -1 } });

		await POST(event);

		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [expect.objectContaining({ quantity: 1 })]
			})
		);
	});

	it('Clamps seats above 100 to 100', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeTeamCheckoutDb({ existingTeam: null });
		const event = makeRequestEvent({ db, body: { name: 'Max Team', seats: 999 } });

		await POST(event);

		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [expect.objectContaining({ quantity: 100 })]
			})
		);
	});

	it('Uses annual price when interval is "annual" and annual price ID is set', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeTeamCheckoutDb({ existingTeam: null });
		const event = makeRequestEvent({
			db,
			body: { name: 'Annual Team', seats: 5, interval: 'annual' },
			env: {
				STRIPE_SECRET_KEY: 'sk_test_fake',
				STRIPE_PRO_PRICE_ID: 'price_monthly_123',
				STRIPE_PRO_ANNUAL_PRICE_ID: 'price_annual_456'
			}
		});

		await POST(event);

		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [expect.objectContaining({ price: 'price_annual_456' })]
			})
		);
	});
});
