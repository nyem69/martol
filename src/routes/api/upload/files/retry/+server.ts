/**
 * Retry Failed Extraction — Martol
 *
 * POST /api/upload/files/retry { id: number }
 * Re-dispatches document processing for a failed attachment.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { member } from '$lib/server/db/auth-schema';
import { attachments } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const activeOrgId = locals.session.activeOrganizationId;
	if (!activeOrgId) error(400, 'No active organization');

	// Verify membership (owner/lead only)
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, activeOrgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) error(403, 'Not a member of this organization');
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owners and leads can retry extractions');
	}

	let body: { id: number };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (!body.id || typeof body.id !== 'number') {
		error(400, 'Missing or invalid file ID');
	}

	// Verify attachment exists and is in failed state
	const [att] = await locals.db
		.select({ id: attachments.id, processingStatus: attachments.processingStatus })
		.from(attachments)
		.where(and(eq(attachments.id, body.id), eq(attachments.orgId, activeOrgId)))
		.limit(1);

	if (!att) error(404, 'File not found');
	if (att.processingStatus !== 'failed') {
		error(400, 'File is not in failed state');
	}

	// Reset status to pending
	await locals.db
		.update(attachments)
		.set({ processingStatus: 'pending' })
		.where(eq(attachments.id, att.id));

	// Re-dispatch processing
	const ai = platform?.env?.AI;
	const vectorize = platform?.env?.VECTORIZE;
	const r2 = platform?.env?.STORAGE;
	const ctx = platform?.context;

	if (ai && vectorize && r2 && ctx?.waitUntil) {
		const { processDocument } = await import('$lib/server/rag/process-document');
		ctx.waitUntil(
			processDocument(locals.db, ai, vectorize, r2, att.id, activeOrgId, platform?.env as unknown as Record<string, unknown>)
				.catch((err: unknown) => console.error('[Retry] Processing failed:', err))
		);
	}

	return json({ ok: true });
};
