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
import { attachments } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	// SVG intentionally excluded — can contain embedded scripts (stored XSS)
	'application/pdf',
	'text/plain'
]);

// Strict key format: orgId/timestamp-filename (no path traversal)
const R2_KEY_RE = /^[\w-]+\/[\w][\w._-]*$/;

const MAGIC_BYTES: Record<string, number[][]> = {
	'image/jpeg': [[0xFF, 0xD8, 0xFF]],
	'image/png': [[0x89, 0x50, 0x4E, 0x47]],
	'image/gif': [[0x47, 0x49, 0x46, 0x38]],
	// WebP: RIFF header (bytes 0-3) + WEBP signature (bytes 8-11)
	'image/webp': [[0x52, 0x49, 0x46, 0x46]],
	'application/pdf': [[0x25, 0x50, 0x44, 0x46]]
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
	// Feature flag: uploads disabled unless ENABLE_UPLOADS=true
	if (platform?.env?.ENABLE_UPLOADS !== 'true') {
		error(403, 'Image uploads are currently disabled');
	}

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

	// Early reject oversized requests before buffering the full body
	const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
	if (contentLength > MAX_FILE_SIZE + 4096) {
		error(413, 'Request too large');
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

	// Sanitize filename
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
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

	// Record in attachments table (message_id backfilled when message is persisted)
	// Compensate on DB failure: delete the R2 object to prevent orphans
	try {
		await locals.db.insert(attachments).values({
			orgId: activeOrgId,
			uploadedBy: locals.user.id,
			filename: safeName,
			r2Key,
			contentType: file.type,
			sizeBytes: file.size
		});
	} catch (dbErr) {
		await r2.delete(r2Key).catch(() => {}); // best-effort R2 rollback
		console.error('[Upload] DB insert failed, R2 object deleted:', dbErr);
		error(500, 'Failed to record upload');
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

	return new Response(object.body as ReadableStream, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': disposition,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=86400, immutable'
		}
	});
};
