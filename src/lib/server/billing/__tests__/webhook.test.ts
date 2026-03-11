/**
 * Tests for the Stripe webhook handler at /api/billing/webhook.
 * Mocks createStripe so no real network calls are made.
 * Tests all 5 event types handled in the switch statement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../../../routes/api/billing/webhook/+server';
import { createStripe } from '$lib/server/stripe';
import { TEST_IDS, createMockStripeSubscription } from './helpers';

vi.mock('$lib/server/stripe', () => ({
	createStripe: vi.fn()
}));

const mockCreateStripe = vi.mocked(createStripe);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock SvelteKit request event for the webhook handler.
 */
function makeRequestEvent(body: string, sig: string, db: any, env: Record<string, string> = {}): any {
	return {
		request: new Request('http://localhost/api/billing/webhook', {
			method: 'POST',
			body,
			headers: { 'stripe-signature': sig }
		}),
		platform: {
			env: {
				STRIPE_SECRET_KEY: 'sk_test_fake',
				STRIPE_WEBHOOK_SECRET: 'whsec_test',
				...env
			}
		},
		locals: { db }
	};
}

/**
 * Build a mock Stripe client.
 * constructEvent returns the provided event; subscriptions.retrieve returns the provided sub.
 */
function makeStripeClient(event: any, sub?: any) {
	return {
		webhooks: {
			constructEvent: vi.fn().mockReturnValue(event)
		},
		subscriptions: {
			retrieve: vi.fn().mockResolvedValue(sub ?? createMockStripeSubscription())
		}
	} as any;
}

/**
 * Build a Stripe event wrapper.
 */
function makeStripeEvent(type: string, object: any): any {
	return {
		id: 'evt_test_123',
		type,
		data: { object }
	};
}

/**
 * Build a chainable mock DB for webhook tests.
 *
 * selectResults: array of arrays — consumed in order.
 *   - If the query ends with .limit(), the next entry is consumed.
 *   - If the query ends with .where() (no .limit()), the next entry is also consumed.
 *
 * The selectChain is both chainable and thenable, so:
 *   await db.select().from().where()            → works (consumed via then())
 *   await db.select().from().where().limit(1)   → works (consumed via limit())
 */
function makeWebhookDb(selectResults: any[][] = []) {
	let selectCallCount = 0;

	const updateChain: any = {
		set: vi.fn(),
		where: vi.fn().mockResolvedValue({ rowCount: 1 })
	};
	updateChain.set.mockReturnValue(updateChain);

	const insertChain: any = {
		values: vi.fn().mockResolvedValue(undefined)
	};

	/** Create a thenable+chainable select step. */
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
					// limit() was called, the Promise from limit() takes precedence — this
					// branch should not be reached, but guard anyway.
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
// checkout.session.completed
// ---------------------------------------------------------------------------

describe('checkout.session.completed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Pro checkout creates new subscription record when none exists', async () => {
		// selectResults: [proCount query, existing sub query (empty)]
		const db = makeWebhookDb([[{ count: 50 }], []]);

		const sub = createMockStripeSubscription({
			id: 'sub_pro_new',
			metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG }
		});

		const session = {
			id: 'cs_test_new',
			subscription: 'sub_pro_new',
			customer: 'cus_test_new',
			metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG }
		};

		const event = makeStripeEvent('checkout.session.completed', session);
		mockCreateStripe.mockReturnValue(makeStripeClient(event, sub));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.insert).toHaveBeenCalled();
		expect(db._insertChain.values).toHaveBeenCalledWith(
			expect.objectContaining({
				orgId: TEST_IDS.PRO_ORG,
				plan: 'pro',
				status: 'active',
				stripeSubscriptionId: 'sub_pro_new'
			})
		);
		// update should not have been called for subscription (only insert)
		expect(db.update).not.toHaveBeenCalled();
	});

	it('Pro checkout updates existing subscription record', async () => {
		// selectResults: [proCount query, existing sub query (found)]
		const db = makeWebhookDb([[{ count: 50 }], [{ id: 'existing-sub-id' }]]);

		const sub = createMockStripeSubscription({
			id: 'sub_pro_existing',
			metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG }
		});

		const session = {
			id: 'cs_test_existing',
			subscription: 'sub_pro_existing',
			customer: 'cus_test_existing',
			metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG }
		};

		const event = makeStripeEvent('checkout.session.completed', session);
		mockCreateStripe.mockReturnValue(makeStripeClient(event, sub));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				plan: 'pro',
				status: 'active',
				stripeSubscriptionId: 'sub_pro_existing'
			})
		);
		expect(db.insert).not.toHaveBeenCalled();
	});

	it('Team checkout activates team record', async () => {
		const db = makeWebhookDb([]);

		const sub = createMockStripeSubscription({
			id: 'sub_team_123',
			items: {
				data: [{
					quantity: 10,
					current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
				}]
			},
			metadata: { type: 'team', team_id: TEST_IDS.TEAM_ID }
		});

		const session = {
			id: 'cs_test_team',
			subscription: 'sub_team_123',
			customer: 'cus_team_123',
			metadata: { type: 'team', team_id: TEST_IDS.TEAM_ID }
		};

		const event = makeStripeEvent('checkout.session.completed', session);
		mockCreateStripe.mockReturnValue(makeStripeClient(event, sub));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				seats: 10,
				stripeSubscriptionId: 'sub_team_123',
				stripeCustomerId: 'cus_team_123'
			})
		);
	});

	it('Missing org_id metadata does not write to DB and does not crash', async () => {
		const db = makeWebhookDb([]);

		const sub = createMockStripeSubscription({ id: 'sub_no_meta' });

		const session = {
			id: 'cs_test_no_meta',
			subscription: 'sub_no_meta',
			customer: 'cus_no_meta',
			// type is 'pro' but no org_id
			metadata: { type: 'pro' }
		};

		const event = makeStripeEvent('checkout.session.completed', session);
		mockCreateStripe.mockReturnValue(makeStripeClient(event, sub));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.insert).not.toHaveBeenCalled();
		expect(db.update).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// customer.subscription.updated
// ---------------------------------------------------------------------------

describe('customer.subscription.updated', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Updates Pro subscription status and period when org_id present', async () => {
		const db = makeWebhookDb([]);

		const sub = createMockStripeSubscription({
			id: 'sub_pro_upd',
			status: 'active',
			cancel_at_period_end: true,
			metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG }
		});

		const event = makeStripeEvent('customer.subscription.updated', sub);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				cancelAtPeriodEnd: true
			})
		);
	});

	it('Updates Team subscription when team metadata present', async () => {
		const db = makeWebhookDb([]);

		const sub = createMockStripeSubscription({
			id: 'sub_team_upd',
			status: 'active',
			items: {
				data: [{
					quantity: 7,
					current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
				}]
			},
			metadata: { type: 'team', team_id: TEST_IDS.TEAM_ID }
		});

		const event = makeStripeEvent('customer.subscription.updated', sub);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				seats: 7
			})
		);
	});

	it('Falls back to stripeSubscriptionId when Pro org_id metadata missing', async () => {
		const db = makeWebhookDb([]);

		const sub = createMockStripeSubscription({
			id: 'sub_fallback_pro',
			status: 'past_due',
			// no org_id in metadata
			metadata: {}
		});

		const event = makeStripeEvent('customer.subscription.updated', sub);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'past_due' })
		);
	});
});

// ---------------------------------------------------------------------------
// customer.subscription.deleted
// ---------------------------------------------------------------------------

describe('customer.subscription.deleted', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Cancels Pro subscription when org_id present', async () => {
		const db = makeWebhookDb([]);

		const sub = createMockStripeSubscription({
			id: 'sub_pro_del',
			status: 'canceled',
			metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG }
		});

		const event = makeStripeEvent('customer.subscription.deleted', sub);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'canceled',
				cancelAtPeriodEnd: false
			})
		);
	});

	it('Cancels Team subscription when team_id present', async () => {
		const db = makeWebhookDb([]);

		const sub = createMockStripeSubscription({
			id: 'sub_team_del',
			status: 'canceled',
			metadata: { type: 'team', team_id: TEST_IDS.TEAM_ID }
		});

		const event = makeStripeEvent('customer.subscription.deleted', sub);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'canceled',
				cancelAtPeriodEnd: false
			})
		);
	});
});

// ---------------------------------------------------------------------------
// invoice.payment_succeeded
// ---------------------------------------------------------------------------

describe('invoice.payment_succeeded', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Recovers past_due subscription to active when subscription found', async () => {
		// updateStatusBySubId: first a select returning existing, then update
		const db = makeWebhookDb([[{ id: 'sub-row-id' }]]);

		const invoice = {
			id: 'in_test_succeeded',
			// Use older API shape
			subscription: 'sub_recovered_123'
		};

		const event = makeStripeEvent('invoice.payment_succeeded', invoice);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'active' })
		);
	});

	it('Handles newer invoice API shape (parent.subscription_details)', async () => {
		const db = makeWebhookDb([[{ id: 'sub-row-id' }]]);

		const invoice = {
			id: 'in_test_new_api',
			parent: {
				subscription_details: {
					subscription: 'sub_new_api_123'
				}
			}
		};

		const event = makeStripeEvent('invoice.payment_succeeded', invoice);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'active' })
		);
	});
});

// ---------------------------------------------------------------------------
// invoice.payment_failed
// ---------------------------------------------------------------------------

describe('invoice.payment_failed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Marks subscription as past_due when found in subscriptions table', async () => {
		// updateStatusBySubId finds the sub in subscriptions table
		const db = makeWebhookDb([[{ id: 'sub-row-pastdue' }]]);

		const invoice = {
			id: 'in_test_failed',
			subscription: 'sub_pastdue_123'
		};

		const event = makeStripeEvent('invoice.payment_failed', invoice);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		expect(json).toEqual({ received: true });
		expect(db.update).toHaveBeenCalled();
		expect(db._updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'past_due' })
		);
	});

	it('Falls back to teams table when not found in subscriptions', async () => {
		// updateStatusBySubId: subscriptions select returns empty → falls back to teams update
		const db = makeWebhookDb([[]]);

		const invoice = {
			id: 'in_test_failed_team',
			subscription: 'sub_team_pastdue_123'
		};

		const event = makeStripeEvent('invoice.payment_failed', invoice);
		mockCreateStripe.mockReturnValue(makeStripeClient(event));

		const response = await POST(makeRequestEvent('body', 'sig', db));
		const json = await response.json();

		// Even if not found in subscriptions, should return received:true
		expect(json).toEqual({ received: true });
		// update should have been called (on teams table as fallback)
		expect(db.update).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('webhook error handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Returns 400 when stripe-signature header is missing', async () => {
		const db = makeWebhookDb([]);

		const event: any = {
			request: new Request('http://localhost/api/billing/webhook', {
				method: 'POST',
				body: 'body'
				// no stripe-signature header
			}),
			platform: {
				env: {
					STRIPE_SECRET_KEY: 'sk_test_fake',
					STRIPE_WEBHOOK_SECRET: 'whsec_test'
				}
			},
			locals: { db }
		};

		await expect(POST(event)).rejects.toMatchObject({ status: 400 });
	});

	it('Returns 503 when DB is unavailable', async () => {
		const event: any = {
			request: new Request('http://localhost/api/billing/webhook', {
				method: 'POST',
				body: 'body',
				headers: { 'stripe-signature': 'sig' }
			}),
			platform: {
				env: {
					STRIPE_SECRET_KEY: 'sk_test_fake',
					STRIPE_WEBHOOK_SECRET: 'whsec_test'
				}
			},
			locals: { db: null }
		};

		await expect(POST(event)).rejects.toMatchObject({ status: 503 });
	});

	it('Returns 400 when signature verification fails', async () => {
		const db = makeWebhookDb([]);

		mockCreateStripe.mockReturnValue({
			webhooks: {
				constructEvent: vi.fn().mockImplementation(() => {
					throw new Error('Signature mismatch');
				})
			},
			subscriptions: {
				retrieve: vi.fn()
			}
		} as any);

		await expect(POST(makeRequestEvent('body', 'bad_sig', db))).rejects.toMatchObject({ status: 400 });
	});
});
