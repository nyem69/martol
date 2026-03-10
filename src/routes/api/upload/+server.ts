/**
 * R2 Image Upload Endpoint — Martol
 *
 * POST /api/upload — Upload file to R2, scoped to user's org.
 * Returns the R2 key for embedding in messages.
 *
 * GET /api/upload?key=... — Serve file from R2 with security headers.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { member } from '$lib/server/db/auth-schema';
import { attachments, subscriptions } from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { checkOrgLimits } from '$lib/server/feature-gates';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (documents can be larger than images)
const ALLOWED_TYPES = new Set([
	// Images
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/tiff',
	// SVG intentionally excluded — can contain embedded scripts (stored XSS)
	// Documents
	'application/pdf',
	'text/plain',
	'text/markdown',
	'text/csv',
	// Office
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
	'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
	'application/vnd.oasis.opendocument.text', // .odt
	// Web / data
	'text/html',
	'application/json',
	'text/yaml',
	'application/x-yaml',
	'application/xml',
	'text/xml',
	// Email
	'message/rfc822', // .eml
	// Archives
	'application/zip',
	'application/gzip',
]);

/** Types that Kreuzberg can extract text from (triggers async RAG pipeline). */
const PARSEABLE_TYPES = new Set([
	'application/pdf',
	'text/plain',
	'text/markdown',
	'text/csv',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'application/vnd.oasis.opendocument.text',
	'text/html',
	'application/json',
	'text/yaml',
	'application/x-yaml',
	'application/xml',
	'text/xml',
	'message/rfc822',
	'application/zip',
	'application/gzip',
]);

// Strict key format: orgId/timestamp-filename (no path traversal)
const R2_KEY_RE = /^[\w-]+\/[\w][\w._-]*$/;

const MAGIC_BYTES: Record<string, number[][]> = {
	'image/jpeg': [[0xFF, 0xD8, 0xFF]],
	'image/png': [[0x89, 0x50, 0x4E, 0x47]],
	'image/gif': [[0x47, 0x49, 0x46, 0x38]],
	// WebP: RIFF header (bytes 0-3) + WEBP signature (bytes 8-11)
	'image/webp': [[0x52, 0x49, 0x46, 0x46]],
	'image/tiff': [[0x49, 0x49, 0x2A, 0x00], [0x4D, 0x4D, 0x00, 0x2A]],
	'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
	// ZIP-based formats (DOCX, XLSX, PPTX, ODT, ZIP)
	'application/zip': [[0x50, 0x4B, 0x03, 0x04]],
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4B, 0x03, 0x04]],
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4B, 0x03, 0x04]],
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': [[0x50, 0x4B, 0x03, 0x04]],
	'application/vnd.oasis.opendocument.text': [[0x50, 0x4B, 0x03, 0x04]],
	// Gzip
	'application/gzip': [[0x1F, 0x8B]],
};

// Patterns that indicate HTML/script injection in text/plain files
const DANGEROUS_TEXT_PATTERNS = /(<script|<html|<svg|<iframe|<object|<embed|<style|<link|<meta|<base|javascript:|on\w+\s*=)/i;

function validateMagicBytes(buffer: ArrayBuffer, claimedType: string): boolean {
	const bytes = new Uint8Array(buffer);

	// text/plain: scan full content for HTML injection markers
	if (claimedType === 'text/plain') {
		const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		return !DANGEROUS_TEXT_PATTERNS.test(text);
	}

	// WebP: also verify WEBP signature at bytes 8-11
	if (claimedType === 'image/webp') {
		if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return false;
		if (bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return false;
		return true;
	}

	const sigs = MAGIC_BYTES[claimedType];
	if (!sigs) return true;
	return sigs.some((sig) => sig.every((byte, i) => bytes[i] === byte));
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const r2 = platform?.env?.STORAGE;
	if (!r2) error(503, 'Storage unavailable');

	// Resolve org from session
	const activeOrgId = locals.session.activeOrganizationId;
	if (!activeOrgId) error(400, 'No active organization');

	// Verify membership
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, activeOrgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) error(403, 'Not a member of this organization');
	if (memberRecord.role === 'viewer') error(403, 'Viewers cannot upload files');

	// Feature gate: check upload limits
	const orgLimits = await checkOrgLimits(locals.db, activeOrgId);
	if (orgLimits.usage.uploads >= orgLimits.limits.maxUploads) {
		return new Response(
			JSON.stringify({ error: { message: 'Upload limit reached. Upgrade to Pro for unlimited uploads.', code: 'upload_limit' } }),
			{ status: 403, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// Early reject oversized requests before buffering the full body
	const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
	if (contentLength > MAX_FILE_SIZE + 4096) {
		error(413, 'Request too large');
	}

	// Storage quota check
	if (orgLimits.usage.storageBytes + contentLength > orgLimits.limits.maxStorageBytes) {
		return new Response(
			JSON.stringify({ error: { message: 'Storage limit reached. Delete files or upgrade to free up space.' } }),
			{ status: 413, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const formData = await request.formData();
	const file = formData.get('file');
	if (!file || !(file instanceof File)) error(400, 'No file provided');
	if (file.size > MAX_FILE_SIZE) error(413, 'File too large (max 10 MB)');
	if (!ALLOWED_TYPES.has(file.type)) error(415, 'File type not allowed');

	const buffer = await file.arrayBuffer();
	if (!validateMagicBytes(buffer, file.type)) {
		error(415, 'File content does not match declared type');
	}

	// Image scanning via Workers AI (guarded by env var)
	const ai = platform?.env?.AI;
	const scanEnabled = platform?.env?.ENABLE_IMAGE_SCANNING === 'true';
	if (ai && scanEnabled && file.type.startsWith('image/')) {
		const { scanImage } = await import('$lib/server/image-scan');
		const scanResult = await scanImage(ai, buffer, file.type);
		if (!scanResult.safe) {
			error(422, `Image blocked: ${scanResult.reason || 'unsafe content detected'}`);
		}
	}

	// Sanitize filename
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'upload';
	const timestamp = Date.now();
	const r2Key = `${activeOrgId}/${timestamp}-${safeName}`;

	// Images served inline; non-images forced to download
	const isImage = file.type.startsWith('image/');
	const disposition = isImage
		? `inline; filename="${safeName}"`
		: `attachment; filename="${safeName}"`;

	await r2.put(r2Key, buffer, {
		httpMetadata: {
			contentType: file.type,
			contentDisposition: disposition
		},
		customMetadata: {
			uploadedBy: locals.user.id,
			orgId: activeOrgId
		}
	});

	// Determine if file is parseable for RAG (text extraction + embedding)
	const isParseable = PARSEABLE_TYPES.has(file.type);

	// Record in attachments table (message_id backfilled when message is persisted)
	// Compensate on DB failure: delete the R2 object to prevent orphans
	let insertedId: number | null = null;
	try {
		const [inserted] = await locals.db.insert(attachments).values({
			orgId: activeOrgId,
			uploadedBy: locals.user.id,
			filename: safeName,
			r2Key,
			contentType: file.type,
			sizeBytes: file.size,
			processingStatus: isParseable ? 'pending' : 'skipped',
		}).returning({ id: attachments.id });
		insertedId = inserted?.id ?? null;

		// Increment cached storage counter
		await locals.db
			.update(subscriptions)
			.set({ storageBytesUsed: sql`${subscriptions.storageBytesUsed} + ${file.size}` })
			.where(eq(subscriptions.orgId, activeOrgId));
	} catch (dbErr) {
		await r2.delete(r2Key).catch(() => {}); // best-effort R2 rollback
		console.error('[Upload] DB insert failed, R2 object deleted:', dbErr);
		error(500, 'Failed to record upload');
	}

	// Trigger async RAG processing via waitUntil (non-blocking)
	if (isParseable && insertedId && platform?.env?.VECTORIZE) {
		const ctx = platform.context;
		if (ctx?.waitUntil) {
			const { processDocument } = await import('$lib/server/rag/process-document');
			ctx.waitUntil(
				processDocument(
					locals.db,
					platform.env.AI,
					platform.env.VECTORIZE,
					platform.env.STORAGE,
					insertedId,
					activeOrgId
				).catch((err: unknown) => console.error('[RAG] Background processing failed:', err))
			);
		}
	}

	return json({
		ok: true,
		key: r2Key,
		filename: safeName,
		contentType: file.type,
		sizeBytes: file.size
	});
};

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const r2 = platform?.env?.STORAGE;
	if (!r2) error(503, 'Storage unavailable');

	const key = url.searchParams.get('key');
	if (!key) error(400, 'Missing key parameter');
	if (!R2_KEY_RE.test(key)) error(400, 'Invalid key format');

	// Org scoping: key starts with orgId — verify membership
	const orgId = key.split('/')[0];

	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);
	if (!memberRecord) error(403, 'Not a member of this organization');

	// Verify attachment exists in DB for this org (prevents cross-org key guessing)
	const [attachment] = await locals.db
		.select({ id: attachments.id })
		.from(attachments)
		.where(and(eq(attachments.r2Key, key), eq(attachments.orgId, orgId)))
		.limit(1);
	if (!attachment) error(404, 'File not found');

	// SECURITY NOTE: Auth + membership + DB validation run ABOVE this line.
	// Cache lookup is safe here — it only returns previously-authenticated responses
	// keyed by org-scoped R2 key. Unauthenticated requests never reach this point.
	//
	// Caching image responses enables CSAM scanning (Caching > Configuration in dashboard).
	// private directive: Workers Cache API ignores it for cache.put(), but prevents CDN bypass.
	const cache = platform?.caches?.default;
	const cacheKey = new Request(`${url.origin}/api/upload?key=${key}`, { method: 'GET' });

	if (cache) {
		const cached = await cache.match(cacheKey);
		if (cached) return cached;
	}

	const object = await r2.get(key);
	if (!object) error(404, 'File not found');

	// Re-validate stored content type against allowlist — never trust R2 metadata blindly
	const storedType = object.httpMetadata?.contentType || 'application/octet-stream';
	const contentType = ALLOWED_TYPES.has(storedType) ? storedType : 'application/octet-stream';

	// Images served inline for <img> rendering; non-images forced to download
	const isImage = contentType.startsWith('image/');
	const disposition = isImage
		? (object.httpMetadata?.contentDisposition?.replace('attachment', 'inline') || 'inline')
		: (object.httpMetadata?.contentDisposition || 'attachment');

	const response = new Response(object.body as ReadableStream, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': disposition,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=86400, immutable'
		}
	});

	// Put into edge cache for CSAM scanning and performance.
	// waitUntil keeps the worker alive for the async cache write without blocking the response.
	if (cache) {
		platform?.context?.waitUntil(cache.put(cacheKey, response.clone()));
	}

	return response;
};
