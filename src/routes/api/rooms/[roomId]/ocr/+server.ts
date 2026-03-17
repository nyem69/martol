/**
 * OCR Settings API — Martol
 *
 * GET    /api/rooms/[roomId]/ocr — Get OCR enabled status
 * PATCH  /api/rooms/[roomId]/ocr — Toggle OCR { enabled: boolean } (owner/lead only)
 * POST   /api/rooms/[roomId]/ocr — Bulk reindex skipped images (owner/lead only)
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { organization, member } from '$lib/server/db/auth-schema';
import { attachments } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

/** Parse org metadata JSON, returning a plain object. */
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
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = params.roomId;

	// Verify membership
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);
	if (!memberRecord) error(403, 'Not a member of this room');

	const [org] = await locals.db
		.select({ metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);

	const meta = parseMetadata(org?.metadata);
	return json({ ok: true, ocrEnabled: meta.ocrEnabled === true });
};

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = params.roomId;

	// Verify owner/lead
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);
	if (!memberRecord) error(403, 'Not a member of this room');
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owners and leads can change OCR settings');
	}

	let body: { enabled: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	if (typeof body.enabled !== 'boolean') error(400, 'enabled must be a boolean');

	// Read current metadata and merge
	const [org] = await locals.db
		.select({ metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);

	const meta = parseMetadata(org?.metadata);
	meta.ocrEnabled = body.enabled;

	await locals.db
		.update(organization)
		.set({ metadata: JSON.stringify(meta) })
		.where(eq(organization.id, orgId));

	// Broadcast config change to connected WebSocket clients
	if (platform?.env?.CHAT_ROOM && platform?.env?.HMAC_SIGNING_SECRET) {
		try {
			const doId = platform.env.CHAT_ROOM.idFromName(orgId);
			const stub = platform.env.CHAT_ROOM.get(doId);
			await stub.fetch(new Request('https://do/notify-config', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': platform.env.HMAC_SIGNING_SECRET
				},
				body: JSON.stringify({ field: 'ocr_enabled', value: body.enabled, changedBy: locals.user!.id })
			}));
		} catch {
			// Non-critical — client will see update on next panel open
		}
	}

	return json({ ok: true, ocrEnabled: body.enabled });
};

/** POST — Bulk reindex skipped image attachments. */
export const POST: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = params.roomId;

	// Verify owner/lead
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);
	if (!memberRecord) error(403, 'Not a member of this room');
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owners and leads can reindex images');
	}

	// Verify OCR is enabled
	const [org] = await locals.db
		.select({ metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);
	const meta = parseMetadata(org?.metadata);
	if (meta.ocrEnabled !== true) {
		error(400, 'OCR is not enabled for this room');
	}

	// Find skipped image attachments
	const skippedImages = await locals.db
		.select({ id: attachments.id, contentType: attachments.contentType })
		.from(attachments)
		.where(
			and(
				eq(attachments.orgId, orgId),
				eq(attachments.processingStatus, 'skipped')
			)
		)
		.limit(50);

	// Filter to image types only
	const imageAttachments = skippedImages.filter(
		(a: { contentType: string }) => a.contentType.startsWith('image/')
	);

	if (imageAttachments.length === 0) {
		return json({ ok: true, queued: 0 });
	}

	// Mark as pending
	for (const att of imageAttachments) {
		await locals.db
			.update(attachments)
			.set({ processingStatus: 'pending' })
			.where(eq(attachments.id, att.id));
	}

	// Dispatch processing
	const ai = platform?.env?.AI;
	const vectorize = platform?.env?.VECTORIZE;
	const r2 = platform?.env?.STORAGE;
	const ctx = platform?.context;

	if (ai && vectorize && r2 && ctx?.waitUntil) {
		const { processDocument } = await import('$lib/server/rag/process-document');
		for (const att of imageAttachments) {
			ctx.waitUntil(
				processDocument(locals.db, ai, vectorize, r2, att.id, orgId, platform?.env as unknown as Record<string, unknown>)
					.catch((err: unknown) => console.error(`[OCR] Reindex failed for attachment ${att.id}:`, err))
			);
		}
	}

	return json({ ok: true, queued: imageAttachments.length });
};
