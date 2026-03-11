/**
 * File Management API — Martol
 *
 * GET  /api/upload/files — List files for current org
 * DELETE /api/upload/files — Delete a file by ID (owner/lead only)
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { member } from '$lib/server/db/auth-schema';
import { attachments, documentChunks, subscriptions, messages } from '$lib/server/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const activeOrgId = locals.session.activeOrganizationId;
	if (!activeOrgId) error(400, 'No active organization');

	// Verify membership
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, activeOrgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) error(403, 'Not a member of this organization');

	const files = await locals.db
		.select({
			id: attachments.id,
			filename: attachments.filename,
			contentType: attachments.contentType,
			sizeBytes: attachments.sizeBytes,
			processingStatus: attachments.processingStatus,
			extractionErrorCode: attachments.extractionErrorCode,
			createdAt: attachments.createdAt,
		})
		.from(attachments)
		.where(eq(attachments.orgId, activeOrgId))
		.orderBy(desc(attachments.createdAt))
		.limit(200);

	return json({
		ok: true,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		data: files.map((f: any) => ({
			id: f.id,
			filename: f.filename,
			content_type: f.contentType,
			size_bytes: f.sizeBytes,
			processing_status: f.processingStatus,
			extraction_error_code: f.extractionErrorCode ?? null,
			created_at: f.createdAt?.toISOString() ?? null,
		})),
	});
};

export const DELETE: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const activeOrgId = locals.session.activeOrganizationId;
	if (!activeOrgId) error(400, 'No active organization');

	// Verify membership and role (owner/lead only)
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, activeOrgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) error(403, 'Not a member of this organization');
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owners and leads can delete files');
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

	// Load attachment to get R2 key, size, and message link
	const [att] = await locals.db
		.select({
			id: attachments.id,
			r2Key: attachments.r2Key,
			filename: attachments.filename,
			sizeBytes: attachments.sizeBytes,
			orgId: attachments.orgId,
			messageId: attachments.messageId,
		})
		.from(attachments)
		.where(and(eq(attachments.id, body.id), eq(attachments.orgId, activeOrgId)))
		.limit(1);

	if (!att) error(404, 'File not found');

	// 1. Delete vectors from Vectorize
	const chunks = await locals.db
		.select({ vectorId: documentChunks.vectorId })
		.from(documentChunks)
		.where(eq(documentChunks.attachmentId, att.id));

	if (chunks.length > 0 && platform?.env?.VECTORIZE) {
		try {
			const vectorIds = chunks.map((c: { vectorId: string }) => c.vectorId);
			await platform.env.VECTORIZE.deleteByIds(vectorIds);
		} catch (err) {
			console.error('[Files] Vectorize delete failed:', err);
		}
	}

	// 2. Delete from R2
	const r2 = platform?.env?.STORAGE;
	if (r2) {
		try {
			await r2.delete(att.r2Key);
		} catch (err) {
			console.error('[Files] R2 delete failed:', err);
		}
	}

	// 3. Delete document chunks from DB
	await locals.db
		.delete(documentChunks)
		.where(eq(documentChunks.attachmentId, att.id));

	// 4. Clean up message body that referenced this file (before deleting attachment)
	if (att.messageId) {
		try {
			await locals.db
				.update(messages)
				.set({
					body: sql`REPLACE(body, ${`[${att.filename}](r2:${att.r2Key})`}, ${`[File deleted: ${att.filename}]`})`,
					editedAt: new Date()
				})
				.where(eq(messages.id, att.messageId));
		} catch (err) {
			console.error('[Files] Message cleanup failed:', err);
		}
	}

	// 5. Delete attachment from DB
	await locals.db
		.delete(attachments)
		.where(eq(attachments.id, att.id));

	// 6. Decrement storage counter
	await locals.db
		.update(subscriptions)
		.set({ storageBytesUsed: sql`GREATEST(${subscriptions.storageBytesUsed} - ${att.sizeBytes}, 0)` })
		.where(eq(subscriptions.orgId, activeOrgId));

	return json({ ok: true });
};
