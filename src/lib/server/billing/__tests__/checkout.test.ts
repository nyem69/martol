/**
 * Tests for POST /api/billing/checkout — Create Stripe Checkout Session
 * Mocks createStripe so no real network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../../../routes/api/billing/checkout/+server';
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
 * Build a mock SvelteKit request event for the checkout handler.
 */
function makeRequestEvent(overrides: {
	user?: any;
	session?: any;
	db?: any;
	env?: Record<string, string> | null;
	body?: Record<string, unknown>;
	orgId?: string;
}): any {
	const {
		user = { id: TEST_IDS.PRO_USER, email: 'pro@example.com' },
		session = { activeOrganizationId: TEST_IDS.PRO_ORG },
		db = makeCheckoutDb(),
		env = DEFAULT_ENV,
		body = {},
		orgId
	} = overrides;

	// Override orgId in session if provided
	const resolvedSession = orgId !== undefined
		? { ...session, activeOrganizationId: orgId }
		: session;

	return {
		request: new Request('http://localhost/api/billing/checkout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		platform: env === null ? undefined : { env },
		locals: { user, session: resolvedSession, db },
		url: new URL('http://localhost/api/billing/checkout')
	};
}

/**
 * Build a mock Stripe client for checkout tests.
 */
function makeStripeClient(overrides: {
	customerId?: string;
	checkoutUrl?: string;
} = {}) {
	return {
		customers: {
			create: vi.fn().mockResolvedValue({ id: overrides.customerId ?? 'cus_new_123' })
		},
		checkout: {
			sessions: {
				create: vi.fn().mockResolvedValue({ url: overrides.checkoutUrl ?? 'https://checkout.stripe.com/test' })
			}
		}
	} as any;
}

/**
 * Build a chainable mock DB for checkout handler tests.
 *
 * Accepts an ordered list of results. Each entry in `limitResults` is consumed
 * in sequence by calls that end with .limit(). The count query uses .then()
 * (no .limit()) and consumes `memberCount`.
 *
 * Typical query order when session.activeOrganizationId is set:
 *   limit[0] → member role check
 *   limit[1] → existing subscription
 *   then      → member count (thenable select, no .limit())
 *
 * When session.activeOrganizationId is NOT set, prepend one more entry:
 *   limit[0] → first org lookup
 *   limit[1] → member role check
 *   limit[2] → existing subscription
 *   then      → member count
 */
function makeCheckoutDb(options: {
	memberRole?: string | null;
	existingSub?: { plan: string; status: string; stripeCustomerId?: string } | null;
	memberCount?: number;
	/** Pass firstOrg ONLY when you want to test the org-fallback path */
	prependFirstOrg?: string | null;
} = {}) {
	const {
		memberRole = 'owner',
		existingSub = null,
		memberCount = 1,
		prependFirstOrg
	} = options;

	// Build ordered queue of limit() results
	const limitResults: any[][] = [];
	if (prependFirstOrg !== undefined) {
		limitResults.push(prependFirstOrg ? [{ orgId: prependFirstOrg }] : []);
	}
	limitResults.push(memberRole !== null ? [{ role: memberRole }] : []);
	limitResults.push(existingSub ? [existingSub] : []);

	let limitIdx = 0;

	function makeSelectStep(_isMemberCountQuery: boolean): any {
		const step: any = {
			from: vi.fn(),
			where: vi.fn(),
			limit: vi.fn().mockImplementation(() => {
				const res = limitResults[limitIdx] ?? [];
				limitIdx++;
				return Promise.resolve(res);
			}),
			// Thenable: used when the handler awaits the chain without .limit()
			then(resolve: any, reject: any) {
				Promise.resolve([{ count: memberCount }]).then(resolve, reject);
			}
		};
		step.from.mockReturnValue(step);
		step.where.mockReturnValue(step);
		return step;
	}

	// selectCallCount helps us detect which select() call is the count query.
	// With activeOrganizationId set: calls 1 and 2 use limit(), call 3 is thenable.
	// With firstOrg prepended: calls 1,2,3 use limit(), call 4 is thenable.
	let selectCallCount = 0;
	const countQueryCallIndex = prependFirstOrg !== undefined ? 4 : 3;

	const db: any = {
		select: vi.fn().mockImplementation(() => {
			selectCallCount++;
			return makeSelectStep(selectCallCount === countQueryCallIndex);
		}),
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined)
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue({ rowCount: 1 })
			})
		})
	};

	return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/billing/checkout', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Creates Stripe Checkout Session with correct monthly price ID', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({
			memberRole: 'owner',
			existingSub: null,
			memberCount: 3
		});

		const event = makeRequestEvent({ db, body: { interval: 'monthly' } });
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://checkout.stripe.com/test' });
		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'subscription',
				line_items: [
					expect.objectContaining({
						price: 'price_monthly_123',
						quantity: 1
					})
				]
			})
		);
	});

	it('Uses annual price when interval is "annual" and annual price ID exists', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({ memberRole: 'owner', existingSub: null, memberCount: 2 });

		const event = makeRequestEvent({
			db,
			body: { interval: 'annual' },
			env: {
				STRIPE_SECRET_KEY: 'sk_test_fake',
				STRIPE_PRO_PRICE_ID: 'price_monthly_123',
				STRIPE_PRO_ANNUAL_PRICE_ID: 'price_annual_456'
			}
		});
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://checkout.stripe.com/test' });
		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [
					expect.objectContaining({ price: 'price_annual_456' })
				]
			})
		);
	});

	it('Falls back to monthly price when annual price ID is not set', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({ memberRole: 'owner', existingSub: null });

		const event = makeRequestEvent({
			db,
			body: { interval: 'annual' },
			env: {
				STRIPE_SECRET_KEY: 'sk_test_fake',
				STRIPE_PRO_PRICE_ID: 'price_monthly_123'
				// no STRIPE_PRO_ANNUAL_PRICE_ID
			}
		});
		await POST(event);

		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [
					expect.objectContaining({ price: 'price_monthly_123' })
				]
			})
		);
	});

	it('Reuses existing Stripe customer when one is on file', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({
			memberRole: 'owner',
			existingSub: {
				plan: 'free',
				status: 'canceled',
				stripeCustomerId: 'cus_x'
			}
		});

		const event = makeRequestEvent({ db });
		await POST(event);

		// Should NOT create a new customer
		expect(stripe.customers.create).not.toHaveBeenCalled();
		// Should use the existing customer ID
		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({ customer: 'cus_x' })
		);
	});

	it('Creates a new Stripe customer when none on file', async () => {
		const stripe = makeStripeClient({ customerId: 'cus_new_123' });
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({
			memberRole: 'owner',
			existingSub: null
		});

		const event = makeRequestEvent({ db });
		await POST(event);

		expect(stripe.customers.create).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'pro@example.com',
				metadata: expect.objectContaining({ org_id: TEST_IDS.PRO_ORG })
			})
		);
		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({ customer: 'cus_new_123' })
		);
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

	it('Rejects when billing not configured (missing STRIPE_SECRET_KEY) with 503', async () => {
		const event = makeRequestEvent({
			env: { STRIPE_PRO_PRICE_ID: 'price_monthly_123' } // no STRIPE_SECRET_KEY
		});

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});

	it('Rejects when billing not configured (missing STRIPE_PRO_PRICE_ID) with 503', async () => {
		const event = makeRequestEvent({
			env: { STRIPE_SECRET_KEY: 'sk_test_fake' } // no STRIPE_PRO_PRICE_ID
		});

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});

	it('Rejects when already on active Pro plan with 400', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({
			memberRole: 'owner',
			existingSub: { plan: 'pro', status: 'active', stripeCustomerId: 'cus_x' }
		});

		const event = makeRequestEvent({ db });

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Rejects non-owner/lead roles with 403', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({ memberRole: 'member' });
		const event = makeRequestEvent({ db });

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(403);
		}
	});

	it('Allows lead role to create checkout session', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({ memberRole: 'lead', existingSub: null, memberCount: 1 });
		const event = makeRequestEvent({ db });

		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://checkout.stripe.com/test' });
	});

	it('Always uses quantity 1 for Pro checkout (per-user billing)', async () => {
		const stripe = makeStripeClient();
		mockCreateStripe.mockReturnValue(stripe);

		const db = makeCheckoutDb({ memberRole: 'owner', existingSub: null });
		const event = makeRequestEvent({ db });

		await POST(event);

		expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [
					expect.objectContaining({ quantity: 1 })
				]
			})
		);
	});
});
