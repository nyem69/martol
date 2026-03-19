/**
 * Tests for AI billing: usage aggregation and overage cap detection.
 */
import { describe, it, expect, vi } from 'vitest';
import { getAiUsageForOrg, getFreeAllowances, isAiCapReached } from '$lib/server/ai-billing';
import { TEST_IDS } from './helpers';

const ORG_ID = TEST_IDS.PRO_ORG;

/**
 * Build a chainable mock DB where:
 * - .where() resolves to `usageRows` (for getAiUsageForOrg)
 * - .limit() resolves to `subRows`   (for isAiCapReached subscription lookup)
 */
function makeDb(usageRows: any[] = [], subRows: any[] = []) {
	const chain: any = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockResolvedValue(usageRows),
		limit: vi.fn().mockResolvedValue(subRows),
	};
	// where() must also be chainable so that .limit() can follow it
	chain.where.mockImplementation((..._args: any[]) => ({
		...chain,
		// when .limit() is called after .where(), resolve with subRows
		limit: vi.fn().mockResolvedValue(subRows),
		// when awaited directly (no .limit()), resolve with usageRows
		then: (resolve: Function, reject: Function) =>
			Promise.resolve(usageRows).then(resolve as any, reject as any),
	}));
	return chain;
}

// ---------------------------------------------------------------------------
// getFreeAllowances
// ---------------------------------------------------------------------------
describe('getFreeAllowances', () => {
	it('returns doc_process: 50', () => {
		expect(getFreeAllowances().doc_process).toBe(50);
	});

	it('returns vector_query: 500', () => {
		expect(getFreeAllowances().vector_query).toBe(500);
	});
});

// ---------------------------------------------------------------------------
// getAiUsageForOrg
// ---------------------------------------------------------------------------
describe('getAiUsageForOrg', () => {
	it('returns zeros when no rows exist', async () => {
		const db = makeDb([]);
		const usage = await getAiUsageForOrg(db, ORG_ID);
		expect(usage).toEqual({ doc_process: 0, vector_query: 0, llm_generation: 0 });
	});

	it('aggregates a single doc_process row', async () => {
		const db = makeDb([{ operation: 'doc_process', count: 30 }]);
		const usage = await getAiUsageForOrg(db, ORG_ID);
		expect(usage.doc_process).toBe(30);
		expect(usage.vector_query).toBe(0);
	});

	it('aggregates multiple rows for both operations', async () => {
		const db = makeDb([
			{ operation: 'doc_process', count: 20 },
			{ operation: 'doc_process', count: 15 },
			{ operation: 'vector_query', count: 300 },
			{ operation: 'vector_query', count: 250 },
		]);
		const usage = await getAiUsageForOrg(db, ORG_ID);
		expect(usage.doc_process).toBe(35);
		expect(usage.vector_query).toBe(550);
	});

	it('ignores rows with unknown operation types', async () => {
		const db = makeDb([
			{ operation: 'unknown_op', count: 999 },
			{ operation: 'doc_process', count: 10 },
		]);
		const usage = await getAiUsageForOrg(db, ORG_ID);
		expect(usage.doc_process).toBe(10);
		expect(usage.vector_query).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// isAiCapReached
// ---------------------------------------------------------------------------
describe('isAiCapReached', () => {
	it('returns false when usage is within free tier', async () => {
		// doc_process: 10/50, vector_query: 100/500 — no overage
		const db = makeDb([
			{ operation: 'doc_process', count: 10 },
			{ operation: 'vector_query', count: 100 },
		]);
		expect(await isAiCapReached(db, ORG_ID)).toBe(false);
	});

	it('returns false when overage is below the $50 default cap', async () => {
		// doc_process: 60 → overage = 10 × 5 = 50 cents
		// vector_query: 600 → overage = 100 × 0.5 = 50 cents
		// total = 100 cents < 5000 cents
		const db = makeDb([
			{ operation: 'doc_process', count: 60 },
			{ operation: 'vector_query', count: 600 },
		]);
		expect(await isAiCapReached(db, ORG_ID)).toBe(false);
	});

	it('returns true when overage hits the default $50 cap exactly', async () => {
		// Need totalCents >= 5000
		// doc_process overage: (1050 - 50) * 5 = 5000 cents; vector_query: 0
		const db = makeDb(
			[{ operation: 'doc_process', count: 1050 }],
			[] // no subscription row → default cap of 5000
		);
		expect(await isAiCapReached(db, ORG_ID)).toBe(true);
	});

	it('returns true when overage exceeds the default cap', async () => {
		// doc_process: 2000 → overage = 1950 × 5 = 9750 cents > 5000
		const db = makeDb(
			[{ operation: 'doc_process', count: 2000 }],
			[]
		);
		expect(await isAiCapReached(db, ORG_ID)).toBe(true);
	});

	it('returns true when overage hits a custom lower cap', async () => {
		// Custom cap: 500 cents ($5)
		// doc_process: 150 → overage = 100 × 5 = 500 cents >= 500 → capped
		const db = makeDb(
			[{ operation: 'doc_process', count: 150 }],
			[{ cap: 500 }]
		);
		expect(await isAiCapReached(db, ORG_ID)).toBe(true);
	});

	it('returns false when overage is just below a custom lower cap', async () => {
		// Custom cap: 500 cents
		// doc_process: 149 → overage = 99 × 5 = 495 cents < 500
		const db = makeDb(
			[{ operation: 'doc_process', count: 149 }],
			[{ cap: 500 }]
		);
		expect(await isAiCapReached(db, ORG_ID)).toBe(false);
	});
});
