/**
 * POST /api/reports — Submit a content report for a message
 *
 * Auth: session-based, any member can report.
 * Body: { messageId: number, reason: string, details?: string }
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member } from '$lib/server/db/auth-schema';
import { contentReports } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const VALID_REASONS = ['csam', 'nsfw', 'spam', 'scam', 'harassment', 'other'] as const;
type Reason = (typeof VALID_REASONS)[number];

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	// Parse and validate body
	let body: { messageId: unknown; reason: unknown; details?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const { messageId, reason, details } = body;

	if (typeof messageId !== 'number' || !Number.isInteger(messageId)) {
		error(400, 'messageId must be an integer');
	}
	if (typeof reason !== 'string' || !VALID_REASONS.includes(reason as Reason)) {
		error(400, 'Invalid reason');
	}
	if (details !== undefined && typeof details !== 'string') {
		error(400, 'details must be a string');
	}
	if (typeof details === 'string' && details.length > 2000) {
		error(400, 'details must be 2000 characters or fewer');
	}

	// Resolve orgId from session or first membership
	let orgId = locals.session.activeOrganizationId;
	if (!orgId) {
		const [firstMembership] = await locals.db
			.select({ orgId: member.organizationId })
			.from(member)
			.where(eq(member.userId, locals.user.id))
			.limit(1);
		if (!firstMembership) error(400, 'No active organization');
		orgId = firstMembership.orgId;
	}

	// Insert report
	await locals.db.insert(contentReports).values({
		orgId,
		messageId: messageId as number,
		reporterId: locals.user.id,
		reason: reason as Reason,
		details: (details as string) || null
	});

	return json({ ok: true });
};
