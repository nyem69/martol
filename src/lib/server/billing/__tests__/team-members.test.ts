/**
 * Tests for POST /api/billing/team/members and DELETE /api/billing/team/members.
 * Covers seat assignment, seat limits, duplicate prevention, and member removal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, DELETE } from '../../../../routes/api/billing/team/members/+server';
import { TEST_IDS } from './helpers';

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

function makeTeamMembersDb(options: {
	team?: any;
	targetUser?: any;
	memberCount?: number;
	existingMember?: any;
}) {
	const { team, targetUser, memberCount = 0, existingMember } = options;

	let selectCallCount = 0;

	/**
	 * The server queries are:
	 *   1. getOwnedTeam:              .select().from().where().limit(1)    → team row
	 *   2. find user by email:        .select().from().where().limit(1)    → user row
	 *   (inside transaction)
	 *   3. count members:             .select().from().where()             → [{ count }]  (NO .limit)
	 *   4. check existing member:     .select().from().where().limit(1)    → member row
	 *
	 * To handle the NO-limit case we make the value returned by .where()
	 * a thenable so `await chain.where()` resolves correctly.
	 */
	function makeResult(callIndex: number): any[] {
		switch (callIndex) {
			case 1: return team ? [team] : [];
			case 2: return targetUser ? [targetUser] : [];
			case 3: return [{ count: memberCount }];
			case 4: return existingMember ? [existingMember] : [];
			default: return [];
		}
	}

	// Build chain object first so self-references work
	const chain: any = {};

	chain.select = vi.fn(() => {
		selectCallCount++;
		// Return a fresh step object for every select so .where() can be thenable
		// without interfering with other calls.
		const callIndex = selectCallCount;

		const step: any = {};
		step.from = vi.fn().mockReturnValue(step);
		step.innerJoin = vi.fn().mockReturnValue(step);
		step.where = vi.fn(() => {
			const result = makeResult(callIndex);
			// Make the where-result a thenable so `await query.where()` works.
			// Also keep .limit() for queries that use it.
			const whereResult: any = {
				then(resolve: any, reject: any) {
					Promise.resolve(result).then(resolve, reject);
				},
				limit: vi.fn().mockResolvedValue(result)
			};
			return whereResult;
		});
		return step;
	});

	chain.insert = vi.fn().mockReturnValue(chain);
	chain.values = vi.fn().mockResolvedValue(undefined);
	chain.delete = vi.fn().mockReturnValue(chain);
	chain.where = vi.fn().mockReturnValue(chain);  // for delete's .where()
	chain.update = vi.fn().mockReturnValue(chain);
	chain.set = vi.fn().mockReturnValue(chain);
	chain.transaction = vi.fn().mockImplementation(async (fn: Function) => fn(chain));

	return chain;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTIVE_TEAM = {
	id: TEST_IDS.TEAM_ID,
	ownerId: TEST_IDS.TEAM_OWNER,
	status: 'active',
	seats: 5
};

const INACTIVE_TEAM = {
	id: TEST_IDS.TEAM_ID,
	ownerId: TEST_IDS.TEAM_OWNER,
	status: 'canceled',
	seats: 5
};

const TARGET_USER = {
	id: TEST_IDS.TEAM_MEMBER
};

const EXISTING_MEMBER = {
	id: 'team-member-row-id'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePostEvent(body: any, locals: any): any {
	return {
		request: new Request('http://localhost/api/billing/team/members', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals
	};
}

function makeDeleteEvent(body: any, locals: any): any {
	return {
		request: new Request('http://localhost/api/billing/team/members', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals
	};
}

function makeLocals(db: any, userId = TEST_IDS.TEAM_OWNER) {
	return {
		user: { id: userId },
		session: { id: 'sess-123' },
		db
	};
}

// ---------------------------------------------------------------------------
// POST — Assign member
// ---------------------------------------------------------------------------

describe('POST /api/billing/team/members', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Adds member within seat limit → {success: true}', async () => {
		const db = makeTeamMembersDb({
			team: ACTIVE_TEAM,
			targetUser: TARGET_USER,
			memberCount: 2,
			existingMember: null
		});

		const response = await POST(makePostEvent(
			{ email: 'member@example.com' },
			makeLocals(db)
		));
		const json = await response.json();

		expect(json).toEqual({ success: true });
		expect(db.insert).toHaveBeenCalled();
		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: TEST_IDS.TEAM_ID,
				userId: TEST_IDS.TEAM_MEMBER
			})
		);
	});

	it('Rejects when seats full → 400', async () => {
		const db = makeTeamMembersDb({
			team: { ...ACTIVE_TEAM, seats: 3 },
			targetUser: TARGET_USER,
			memberCount: 3,
			existingMember: null
		});

		try {
			await POST(makePostEvent(
				{ email: 'member@example.com' },
				makeLocals(db)
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
			expect(e.body.message).toContain('seats are filled');
		}
	});

	it('Rejects duplicate assignment → 400', async () => {
		const db = makeTeamMembersDb({
			team: ACTIVE_TEAM,
			targetUser: TARGET_USER,
			memberCount: 2,
			existingMember: EXISTING_MEMBER
		});

		try {
			await POST(makePostEvent(
				{ email: 'member@example.com' },
				makeLocals(db)
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
			expect(e.body.message).toContain('already assigned');
		}
	});

	it('Rejects when no team found for user → 404', async () => {
		const db = makeTeamMembersDb({
			team: null,
			targetUser: TARGET_USER
		});

		try {
			await POST(makePostEvent(
				{ email: 'member@example.com' },
				makeLocals(db)
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(404);
		}
	});

	it('Rejects when team is not active → 400', async () => {
		const db = makeTeamMembersDb({
			team: INACTIVE_TEAM,
			targetUser: TARGET_USER
		});

		try {
			await POST(makePostEvent(
				{ email: 'member@example.com' },
				makeLocals(db)
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
			expect(e.body.message).toContain('not active');
		}
	});

	it('Rejects when target user not found → 404', async () => {
		const db = makeTeamMembersDb({
			team: ACTIVE_TEAM,
			targetUser: null
		});

		try {
			await POST(makePostEvent(
				{ email: 'nobody@example.com' },
				makeLocals(db)
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(404);
		}
	});

	it('Rejects when email is missing → 400', async () => {
		const db = makeTeamMembersDb({ team: ACTIVE_TEAM });

		try {
			await POST(makePostEvent({}, makeLocals(db)));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Rejects unauthenticated request → 401', async () => {
		const db = makeTeamMembersDb({ team: ACTIVE_TEAM });

		try {
			await POST(makePostEvent(
				{ email: 'member@example.com' },
				{ user: null, session: null, db }
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(401);
		}
	});

	it('Rejects when DB unavailable → 503', async () => {
		try {
			await POST(makePostEvent(
				{ email: 'member@example.com' },
				{ user: { id: TEST_IDS.TEAM_OWNER }, session: { id: 'sess-123' }, db: null }
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(503);
		}
	});
});

// ---------------------------------------------------------------------------
// DELETE — Remove member
// ---------------------------------------------------------------------------

describe('DELETE /api/billing/team/members', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Removes member successfully → {success: true}', async () => {
		const db = makeTeamMembersDb({ team: ACTIVE_TEAM });

		const response = await DELETE(makeDeleteEvent(
			{ userId: TEST_IDS.TEAM_MEMBER },
			makeLocals(db)
		));
		const json = await response.json();

		expect(json).toEqual({ success: true });
		expect(db.delete).toHaveBeenCalled();
	});

	it('Rejects when no team found for user → 404', async () => {
		const db = makeTeamMembersDb({ team: null });

		try {
			await DELETE(makeDeleteEvent(
				{ userId: TEST_IDS.TEAM_MEMBER },
				makeLocals(db)
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(404);
		}
	});

	it('Rejects when userId is missing → 400', async () => {
		const db = makeTeamMembersDb({ team: ACTIVE_TEAM });

		try {
			await DELETE(makeDeleteEvent({}, makeLocals(db)));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(400);
		}
	});

	it('Rejects unauthenticated request → 401', async () => {
		const db = makeTeamMembersDb({ team: ACTIVE_TEAM });

		try {
			await DELETE(makeDeleteEvent(
				{ userId: TEST_IDS.TEAM_MEMBER },
				{ user: null, session: null, db }
			));
			expect.unreachable('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(401);
		}
	});
});
