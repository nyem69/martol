/**
 * GET /api/rooms/[roomId]/brief — Read current brief
 * PUT /api/rooms/[roomId]/brief — Update brief (owner/lead only)
 *
 * Auth: session-based, must be room member.
 * Reads from project_brief table (active row), falls back to organization.metadata.
 * Writes always go to project_brief table (versioned).
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member, organization } from '$lib/server/db/auth-schema';
import { projectBrief } from '$lib/server/db/schema';
import { getActiveBrief } from '$lib/server/db/brief';
import { eq, and, sql } from 'drizzle-orm';

const MAX_BRIEF_LENGTH = 10_000;

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const db = locals.db;
	const orgId = params.roomId;

	// Verify membership
	const [memberRecord] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}

	const brief = await getActiveBrief(db, orgId);

	return json({ ok: true, brief: brief.content ?? '', version: brief.version });
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const db = locals.db;
	const orgId = params.roomId;

	// Verify membership and role
	const [memberRecord] = await db
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}

	if (memberRecord.role !== 'owner' && memberRecord.role !== 'admin') {
		error(403, 'Only owners and leads can edit the brief');
	}

	// Parse body
	let body: { brief: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
	}

	if (typeof body.brief !== 'string') {
		return json({ ok: false, error: 'brief must be a string' }, { status: 400 });
	}

	if (body.brief.length > MAX_BRIEF_LENGTH) {
		return json({ ok: false, error: `brief exceeds ${MAX_BRIEF_LENGTH} characters` }, { status: 400 });
	}

	// Versioned insert in a transaction with serialization lock
	let newVersion: number;
	try {
		newVersion = await db.transaction(async (tx: typeof db) => {
			// Lock the org row to serialize concurrent brief updates
			await tx
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.id, orgId))
				.for('update');

			// Get current max version for this org
			const [{ maxVersion }] = await tx
				.select({ maxVersion: sql<number>`COALESCE(MAX(${projectBrief.version}), 0)` })
				.from(projectBrief)
				.where(eq(projectBrief.orgId, orgId));

			// Archive current active brief (if any)
			await tx
				.update(projectBrief)
				.set({ status: 'archived' })
				.where(and(eq(projectBrief.orgId, orgId), eq(projectBrief.status, 'active')));

			// Insert new active version
			const version = maxVersion + 1;
			await tx.insert(projectBrief).values({
				orgId,
				content: body.brief as string,
				version,
				status: 'active',
				createdBy: locals.user!.id
			});

			return version;
		});
	} catch (e: any) {
		// Unique constraint violation from partial index = concurrent write conflict
		if (e?.code === '23505') {
			return json({ ok: false, error: 'Conflict: brief was updated by another user' }, { status: 409 });
		}
		throw e;
	}

	return json({ ok: true, version: newVersion });
};
