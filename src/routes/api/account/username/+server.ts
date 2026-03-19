/**
 * PUT /api/account/username — Change username
 *
 * Auth: session-based.
 * Validates: 3-32 chars, [a-zA-Z0-9_] only, case-insensitive uniqueness,
 * reserved words, 90-day cooldown, old username hold period.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { user, organization, member } from '$lib/server/db/auth-schema';
import { usernameHistory, accountAudit } from '$lib/server/db/schema';
import { eq, desc, sql, and } from 'drizzle-orm';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const RESERVED_WORDS = new Set([
	'admin',
	'system',
	'agent',
	'bot',
	'martol',
	'support',
	'help',
	'null',
	'undefined',
	'deleted',
	'sales',
	'moderator',
	'mod',
	'root',
	'security',
	'abuse',
	'postmaster',
	'info',
	'noreply',
	'api',
	'www',
	'staff',
	'team',
	'official'
]);
const COOLDOWN_DAYS = 90;

export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const currentUser = locals.user;
	const db = locals.db;

	// Parse body
	let body: { username: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const newUsername = typeof body.username === 'string' ? body.username.trim() : '';

	// ── Validation ──

	if (!USERNAME_RE.test(newUsername)) {
		return json(
			{ ok: false, error: 'Username must be 3-32 characters: letters, digits, underscore.' },
			{ status: 400 }
		);
	}

	if (RESERVED_WORDS.has(newUsername.toLowerCase())) {
		return json(
			{ ok: false, error: 'This username is reserved.' },
			{ status: 400 }
		);
	}

	// Check if same as current (case-insensitive)
	const currentUsername = locals.user.username ?? '';
	if (currentUsername.toLowerCase() === newUsername.toLowerCase()) {
		return json(
			{ ok: false, error: 'This is already your username.' },
			{ status: 400 }
		);
	}

	// ── 90-day cooldown ──

	const [lastChange] = await db
		.select({ changedAt: usernameHistory.changedAt })
		.from(usernameHistory)
		.where(eq(usernameHistory.userId, currentUser.id))
		.orderBy(desc(usernameHistory.changedAt))
		.limit(1);

	if (lastChange?.changedAt) {
		const cooldownEnd = new Date(lastChange.changedAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
		if (new Date() < cooldownEnd) {
			const daysLeft = Math.ceil((cooldownEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
			return json(
				{ ok: false, error: `Username can be changed again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` },
				{ status: 429 }
			);
		}
	}

	// ── Case-insensitive uniqueness check ──

	const [existing] = await db
		.select({ id: user.id })
		.from(user)
		.where(sql`LOWER(${user.username}) = LOWER(${newUsername})`)
		.limit(1);

	if (existing) {
		return json(
			{ ok: false, error: 'This username is already taken.' },
			{ status: 409 }
		);
	}

	// ── Old username hold check ──
	// Prevent taking a username that someone else recently changed FROM
	// (held for 90 days via releasedAt)

	const now = new Date();

	const [heldUsername] = await db
		.select({ userId: usernameHistory.userId })
		.from(usernameHistory)
		.where(
			sql`LOWER(${usernameHistory.oldUsername}) = LOWER(${newUsername})
				AND ${usernameHistory.userId} != ${currentUser.id}
				AND (${usernameHistory.releasedAt} IS NULL OR ${usernameHistory.releasedAt} > ${now})`
		)
		.limit(1);

	if (heldUsername) {
		return json(
			{ ok: false, error: 'This username is temporarily reserved.' },
			{ status: 409 }
		);
	}

	// ── Apply change (atomic transaction with unique constraint catch) ──

	const releasedAt = new Date(now.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
	const ipAddress = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for');
	const userAgent = request.headers.get('user-agent');

	try {
		await db.transaction(async (tx: typeof db) => {
			await tx
				.update(user)
				.set({ username: newUsername, updatedAt: now })
				.where(eq(user.id, currentUser.id));

			await tx.insert(usernameHistory).values({
				userId: currentUser.id,
				oldUsername: currentUsername,
				newUsername: newUsername,
				changedAt: now,
				releasedAt: releasedAt
			});

			await tx.insert(accountAudit).values({
				userId: currentUser.id,
				action: 'username_change',
				oldValue: currentUsername,
				newValue: newUsername,
				ipAddress,
				userAgent
			});

			// Update auto-generated room names for owned rooms
			// Match both current username and any previous auto-generated patterns
			const newRoomName = `${newUsername}'s Room`;
			const ownedOrgs = await tx
				.select({ orgId: member.organizationId, orgName: organization.name })
				.from(member)
				.innerJoin(organization, eq(organization.id, member.organizationId))
				.where(and(eq(member.userId, currentUser.id), eq(member.role, 'owner')));

			for (const org of ownedOrgs) {
				// Rename if it ends with "'s Room" (auto-generated pattern)
				if (org.orgName?.endsWith('\u2019s Room') || org.orgName?.endsWith("'s Room")) {
					await tx
						.update(organization)
						.set({ name: newRoomName })
						.where(eq(organization.id, org.orgId));
				}
			}
		});
	} catch (err: any) {
		if (err?.code === '23505') {
			return json(
				{ ok: false, error: 'Username is already taken.' },
				{ status: 409 }
			);
		}
		throw err;
	}

	return json({ ok: true, username: newUsername });
};
