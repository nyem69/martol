/**
 * Tests for the Stripe billing portal endpoint at /api/billing/portal.
 * Mocks createStripe so no real network calls are made.
 * Tests owner/lead access, missing billing account, and auth errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../../../routes/api/billing/portal/+server';
import { createStripe } from '$lib/server/stripe';
import { TEST_IDS } from './helpers';

vi.mock('$lib/server/stripe', () => ({
	createStripe: vi.fn()
}));

const mockCreateStripe = vi.mocked(createStripe);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock SvelteKit request event for the portal handler.
 */
function makeRequestEvent(
	db: any,
	user: any = { id: TEST_IDS.PRO_USER },
	session: any = { activeOrganizationId: TEST_IDS.PRO_ORG },
	env: Record<string, string> = {}
): any {
	return {
		request: new Request('http://localhost/api/billing/portal', {
			method: 'POST'
		}),
		url: new URL('http://localhost/api/billing/portal'),
		platform: {
			env: {
				STRIPE_SECRET_KEY: 'sk_test_fake',
				...env
			}
		},
		locals: { db, user, session }
	};
}

/**
 * Build a mock Stripe client for portal tests.
 * billingPortal.sessions.create returns the provided portal session.
 */
function makeStripeClient(portalUrl: string = 'https://billing.stripe.com/session/test') {
	return {
		billingPortal: {
			sessions: {
				create: vi.fn().mockResolvedValue({ url: portalUrl })
			}
		}
	} as any;
}

/**
 * Build a chainable mock DB with sequential select results.
 *
 * selectResults: array of arrays — consumed in order per select call.
 */
function makePortalDb(selectResults: any[][] = []) {
	let selectCallCount = 0;

	function makeSelectStep(): any {
		const step: any = {
			from: vi.fn(),
			where: vi.fn(),
			limit: vi.fn().mockImplementation(() => {
				const result = selectResults[selectCallCount] ?? [];
				selectCallCount++;
				return Promise.resolve(result);
			})
		};
		step.from.mockReturnValue(step);
		step.where.mockReturnValue(step);
		return step;
	}

	const db: any = {
		select: vi.fn().mockImplementation(() => makeSelectStep())
	};

	return db;
}

// ---------------------------------------------------------------------------
// Success cases
// ---------------------------------------------------------------------------

describe('portal success cases', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Returns Stripe portal URL for org owner', async () => {
		// selectResults: [memberRecord (owner), subscription with stripeCustomerId]
		const db = makePortalDb([
			[{ role: 'owner' }],
			[{ stripeCustomerId: 'cus_test_123' }]
		]);

		mockCreateStripe.mockReturnValue(makeStripeClient());

		const event = makeRequestEvent(db);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://billing.stripe.com/session/test' });
	});

	it('Returns Stripe portal URL for org lead', async () => {
		// selectResults: [memberRecord (lead), subscription with stripeCustomerId]
		const db = makePortalDb([
			[{ role: 'lead' }],
			[{ stripeCustomerId: 'cus_test_123' }]
		]);

		mockCreateStripe.mockReturnValue(makeStripeClient());

		const event = makeRequestEvent(db);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://billing.stripe.com/session/test' });
	});

	it('Resolves org from first membership when session has no activeOrganizationId', async () => {
		// When session.activeOrganizationId is null, handler queries first membership.
		// selectResults: [first membership org, memberRecord (owner), subscription]
		const db = makePortalDb([
			[{ orgId: TEST_IDS.PRO_ORG }],
			[{ role: 'owner' }],
			[{ stripeCustomerId: 'cus_test_123' }]
		]);

		mockCreateStripe.mockReturnValue(makeStripeClient());

		const event = makeRequestEvent(db, { id: TEST_IDS.PRO_USER }, { activeOrganizationId: null });
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ url: 'https://billing.stripe.com/session/test' });
	});

	it('Passes correct customer ID and return_url to Stripe portal create', async () => {
		const db = makePortalDb([
			[{ role: 'owner' }],
			[{ stripeCustomerId: 'cus_specific_456' }]
		]);

		const mockStripe = makeStripeClient('https://billing.stripe.com/session/specific');
		mockCreateStripe.mockReturnValue(mockStripe);

		const event = makeRequestEvent(db);
		await POST(event);

		expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				customer: 'cus_specific_456',
				return_url: expect.stringContaining('/settings')
			})
		);
	});
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('portal error handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Returns 401 when user is not authenticated', async () => {
		const db = makePortalDb([]);
		const event = makeRequestEvent(db, null, null);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(401);
		}
	});

	it('Returns 503 when DB is unavailable', async () => {
		const event = makeRequestEvent(null);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});

	it('Returns 503 when STRIPE_SECRET_KEY is missing', async () => {
		const db = makePortalDb([]);
		const event: any = {
			request: new Request('http://localhost/api/billing/portal', { method: 'POST' }),
			url: new URL('http://localhost/api/billing/portal'),
			platform: { env: {} },
			locals: { db, user: { id: TEST_IDS.PRO_USER }, session: { activeOrganizationId: TEST_IDS.PRO_ORG } }
		};

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});

	it('Returns 403 when user is not owner or lead', async () => {
		// selectResults: [memberRecord (member role)]
		const db = makePortalDb([
			[{ role: 'member' }]
		]);

		mockCreateStripe.mockReturnValue(makeStripeClient());

		const event = makeRequestEvent(db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(403);
		}
	});

	it('Returns 403 when user is not a member of the org', async () => {
		// selectResults: [memberRecord (empty)]
		const db = makePortalDb([[]]);

		mockCreateStripe.mockReturnValue(makeStripeClient());

		const event = makeRequestEvent(db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(403);
		}
	});

	it('Returns 400 when no billing account (subscription) found', async () => {
		// selectResults: [memberRecord (owner), subscription (empty)]
		const db = makePortalDb([
			[{ role: 'owner' }],
			[]
		]);

		mockCreateStripe.mockReturnValue(makeStripeClient());

		const event = makeRequestEvent(db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Returns 400 when subscription exists but stripeCustomerId is null', async () => {
		// selectResults: [memberRecord (owner), subscription with null stripeCustomerId]
		const db = makePortalDb([
			[{ role: 'owner' }],
			[{ stripeCustomerId: null }]
		]);

		mockCreateStripe.mockReturnValue(makeStripeClient());

		const event = makeRequestEvent(db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Returns 400 when no active organization is found (no session, no membership)', async () => {
		// When activeOrganizationId is null AND first membership query returns empty.
		const db = makePortalDb([[]]);

		mockCreateStripe.mockReturnValue(makeStripeClient());

		const event = makeRequestEvent(db, { id: TEST_IDS.PRO_USER }, { activeOrganizationId: null });

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});
});
