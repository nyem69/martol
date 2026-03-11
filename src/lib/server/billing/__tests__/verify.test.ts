/**
 * Tests for the Stripe checkout verification endpoint at /api/billing/verify.
 * Mocks createStripe so no real network calls are made.
 * Tests both Pro and Team checkout paths, plus all error cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../../../routes/api/billing/verify/+server';
import { createStripe } from '$lib/server/stripe';
import { TEST_IDS, createMockCheckoutSession } from './helpers';

vi.mock('$lib/server/stripe', () => ({
	createStripe: vi.fn()
}));

const mockCreateStripe = vi.mocked(createStripe);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock SvelteKit request event for the verify handler.
 */
function makeRequestEvent(
	body: Record<string, any>,
	db: any,
	user: any = { id: TEST_IDS.PRO_USER },
	session: any = { activeOrganizationId: TEST_IDS.PRO_ORG },
	env: Record<string, string> = {}
): any {
	return {
		request: new Request('http://localhost/api/billing/verify', {
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'Content-Type': 'application/json' }
		}),
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
 * Build a mock Stripe client for verify tests.
 * checkout.sessions.retrieve returns the provided session.
 */
function makeStripeClient(session: any) {
	return {
		checkout: {
			sessions: {
				retrieve: vi.fn().mockResolvedValue(session)
			}
		}
	} as any;
}

/**
 * Build a chainable mock DB with sequential select results.
 *
 * selectResults: array of arrays — consumed in order per select call.
 * Each step is both chainable and thenable, so queries that end with
 * .where() (no .limit()) work via await just like those that end with .limit().
 * update and insert chains resolve immediately.
 */
function makeVerifyDb(selectResults: any[][] = []) {
	let selectCallCount = 0;

	const updateChain: any = {
		set: vi.fn(),
		where: vi.fn().mockResolvedValue({ rowCount: 1 })
	};
	updateChain.set.mockReturnValue(updateChain);

	const insertChain: any = {
		values: vi.fn().mockResolvedValue(undefined)
	};

	function makeSelectStep(): any {
		let limitCalled = false;

		const step: any = {
			from: vi.fn(),
			where: vi.fn(),
			limit: vi.fn().mockImplementation(() => {
				limitCalled = true;
				const result = selectResults[selectCallCount] ?? [];
				selectCallCount++;
				return Promise.resolve(result);
			}),
			// Thenable: used when await is applied directly without .limit()
			then(resolve: any, reject: any) {
				if (limitCalled) {
					resolve([]);
					return;
				}
				const result = selectResults[selectCallCount] ?? [];
				selectCallCount++;
				Promise.resolve(result).then(resolve, reject);
			}
		};
		step.from.mockReturnValue(step);
		step.where.mockReturnValue(step);
		return step;
	}

	let _lastSelectStep: any = null;

	const db: any = {
		select: vi.fn().mockImplementation(() => {
			_lastSelectStep = makeSelectStep();
			return _lastSelectStep;
		}),
		update: vi.fn().mockReturnValue(updateChain),
		insert: vi.fn().mockReturnValue(insertChain),
		_updateChain: updateChain,
		_insertChain: insertChain,
		get _selectChain() { return _lastSelectStep; }
	};

	return db;
}

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('verify error handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Returns 401 when user is not authenticated', async () => {
		const db = makeVerifyDb([]);
		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db, null, null);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(401);
		}
	});

	it('Returns 503 when DB is unavailable', async () => {
		const event = makeRequestEvent({ session_id: 'cs_test_123' }, null);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});

	it('Returns 503 when STRIPE_SECRET_KEY is missing', async () => {
		const db = makeVerifyDb([]);
		const event: any = {
			request: new Request('http://localhost/api/billing/verify', {
				method: 'POST',
				body: JSON.stringify({ session_id: 'cs_test_123' }),
				headers: { 'Content-Type': 'application/json' }
			}),
			platform: { env: {} },
			locals: { db, user: { id: TEST_IDS.PRO_USER }, session: {} }
		};

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});

	it('Returns 400 when session_id is missing', async () => {
		const db = makeVerifyDb([]);
		const event = makeRequestEvent({}, db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Returns 400 when session mode is not subscription', async () => {
		const db = makeVerifyDb([]);
		const session = createMockCheckoutSession({ mode: 'payment' });
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Returns 402 when payment is not completed', async () => {
		const db = makeVerifyDb([]);
		const session = createMockCheckoutSession({ payment_status: 'unpaid' });
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(402);
		}
	});

	it('Returns 400 when metadata type is unknown', async () => {
		const db = makeVerifyDb([]);
		const session = createMockCheckoutSession({
			metadata: { type: 'enterprise', org_id: TEST_IDS.PRO_ORG }
		});
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});
});

// ---------------------------------------------------------------------------
// Pro path
// ---------------------------------------------------------------------------

describe('verify Pro path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Returns {ok: true, type: "pro"} when existing subscription is found (upsert = update)', async () => {
		// selectResults: [memberRecord (owner), proCount, existing sub (found)]
		const db = makeVerifyDb([
			[{ role: 'owner' }],
			[{ count: 50 }],
			[{ id: 'sub-1' }]
		]);

		const session = createMockCheckoutSession();
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ ok: true, type: 'pro' });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				plan: 'pro',
				status: 'active',
				stripeSubscriptionId: 'sub_test_123',
				stripeCustomerId: 'cus_test_123'
			})
		);
		expect(db.insert).not.toHaveBeenCalled();
	});

	it('Returns {ok: true, type: "pro"} when no existing subscription (upsert = insert)', async () => {
		// selectResults: [memberRecord (owner), proCount, existing sub (empty)]
		const db = makeVerifyDb([
			[{ role: 'owner' }],
			[{ count: 50 }],
			[]
		]);

		const session = createMockCheckoutSession();
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ ok: true, type: 'pro' });
		expect(db.insert).toHaveBeenCalled();
		expect(db._insertChain.values).toHaveBeenCalledWith(
			expect.objectContaining({
				orgId: TEST_IDS.PRO_ORG,
				plan: 'pro',
				status: 'active',
				stripeSubscriptionId: 'sub_test_123'
			})
		);
		expect(db.update).not.toHaveBeenCalled();
	});

	it('Sets foundingMember=true when pro subscription count is below 100', async () => {
		// selectResults: [memberRecord (owner), proCount (below threshold), existing sub (empty)]
		const db = makeVerifyDb([
			[{ role: 'owner' }],
			[{ count: 42 }],
			[]
		]);

		const session = createMockCheckoutSession();
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ ok: true, type: 'pro' });
		expect(db._insertChain.values).toHaveBeenCalledWith(
			expect.objectContaining({ foundingMember: true })
		);
	});

	it('Sets foundingMember=false when pro subscription count is 100 or above', async () => {
		// selectResults: [memberRecord (owner), proCount (at threshold), existing sub (empty)]
		const db = makeVerifyDb([
			[{ role: 'owner' }],
			[{ count: 100 }],
			[]
		]);

		const session = createMockCheckoutSession();
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ ok: true, type: 'pro' });
		expect(db._insertChain.values).toHaveBeenCalledWith(
			expect.objectContaining({ foundingMember: false })
		);
	});

	it('Returns 403 when user is not owner or lead of org', async () => {
		// selectResults: [memberRecord with member role]
		const db = makeVerifyDb([
			[{ role: 'member' }]
		]);

		const session = createMockCheckoutSession();
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(403);
		}
	});

	it('Returns 403 when user is not a member of the org', async () => {
		// selectResults: [memberRecord (empty)]
		const db = makeVerifyDb([[]]);

		const session = createMockCheckoutSession();
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(403);
		}
	});

	it('Accepts lead role (not just owner)', async () => {
		// selectResults: [memberRecord (lead), proCount, existing sub (found)]
		const db = makeVerifyDb([
			[{ role: 'lead' }],
			[{ count: 50 }],
			[{ id: 'sub-1' }]
		]);

		const session = createMockCheckoutSession();
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ ok: true, type: 'pro' });
	});

	it('Accepts no_payment_required payment status', async () => {
		// selectResults: [memberRecord (owner), proCount, existing sub (found)]
		const db = makeVerifyDb([
			[{ role: 'owner' }],
			[{ count: 50 }],
			[{ id: 'sub-1' }]
		]);

		const session = createMockCheckoutSession({ payment_status: 'no_payment_required' });
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ ok: true, type: 'pro' });
	});
});

// ---------------------------------------------------------------------------
// Team path
// ---------------------------------------------------------------------------

describe('verify Team path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Returns {ok: true, type: "team"} when user owns the team', async () => {
		// selectResults: [teamRecord (found)]
		const db = makeVerifyDb([
			[{ id: 'team-1' }]
		]);

		const session = createMockCheckoutSession({
			metadata: { type: 'team', team_id: TEST_IDS.TEAM_ID }
		});
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent(
			{ session_id: 'cs_test_123' },
			db,
			{ id: TEST_IDS.TEAM_OWNER },
			{ activeOrganizationId: TEST_IDS.TEAM_OWNER_ORG }
		);
		const response = await POST(event);
		const json = await response.json();

		expect(json).toEqual({ ok: true, type: 'team' });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				stripeCustomerId: 'cus_test_123',
				stripeSubscriptionId: 'sub_test_123'
			})
		);
	});

	it('Returns 403 when user does not own the team', async () => {
		// selectResults: [teamRecord (empty — not owner)]
		const db = makeVerifyDb([[]]);

		const session = createMockCheckoutSession({
			metadata: { type: 'team', team_id: TEST_IDS.TEAM_ID }
		});
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent(
			{ session_id: 'cs_test_123' },
			db,
			{ id: TEST_IDS.TEAM_MEMBER },
			{ activeOrganizationId: TEST_IDS.TEAM_OWNER_ORG }
		);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(403);
		}
	});

	it('Returns 400 when team_id is missing from session metadata', async () => {
		const db = makeVerifyDb([]);

		const session = createMockCheckoutSession({
			metadata: { type: 'team' }
		});
		mockCreateStripe.mockReturnValue(makeStripeClient(session));

		const event = makeRequestEvent({ session_id: 'cs_test_123' }, db);

		try {
			await POST(event);
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});
});
