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
import { eq, and, sql } from 'drizzle-orm';

const MAX_BRIEF_LENGTH = 10_000;

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

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

	// Try project_brief table first (active row)
	const [activeBrief] = await db
		.select({ content: projectBrief.content, version: projectBrief.version })
		.from(projectBrief)
		.where(and(eq(projectBrief.orgId, orgId), eq(projectBrief.status, 'active')))
		.limit(1);

	if (activeBrief) {
		return json({ ok: true, brief: activeBrief.content, version: activeBrief.version });
	}

	// Fallback: organization.metadata
	const [org] = await db
		.select({ metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);

	const meta = parseMetadata(org?.metadata);

	return json({
		ok: true,
		brief: typeof meta.brief === 'string' ? meta.brief : '',
		version: 0
	});
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
		error(400, 'Invalid JSON');
	}

	if (typeof body.brief !== 'string') {
		return json({ ok: false, error: 'brief must be a string' }, { status: 400 });
	}

	if (body.brief.length > MAX_BRIEF_LENGTH) {
		return json({ ok: false, error: `brief exceeds ${MAX_BRIEF_LENGTH} characters` }, { status: 400 });
	}

	// Versioned insert in a transaction
	await db.transaction(async (tx: typeof db) => {
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
		await tx.insert(projectBrief).values({
			orgId,
			content: body.brief as string,
			version: maxVersion + 1,
			status: 'active',
			createdBy: locals.user!.id
		});
	});

	return json({ ok: true });
};
