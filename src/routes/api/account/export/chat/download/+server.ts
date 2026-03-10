/**
 * GET /api/account/export/chat/download?token=... — Serve export zip from R2
 *
 * Token format: base64(payload).base64(hmac-sha256-signature)
 * Payload: { key, exp, uid }
 * Validates signature, expiry, and user ownership before serving.
 *
 * Auth: session-based.
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { verifyExportToken } from '$lib/server/export-token';

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');

	const r2 = platform?.env?.STORAGE;
	if (!r2) error(503, 'Storage unavailable');

	const tokenParam = url.searchParams.get('token');
	if (!tokenParam) error(400, 'Missing token');

	// Split into payload and signature
	const dotIndex = tokenParam.indexOf('.');
	if (dotIndex === -1) error(400, 'Invalid token format');

	const payloadB64 = tokenParam.slice(0, dotIndex);
	const sig = tokenParam.slice(dotIndex + 1);

	// Verify HMAC signature
	const tokenSecret = platform?.env?.EXPORT_TOKEN_SECRET || platform?.env?.RESEND_API_KEY;
	if (!tokenSecret) error(500, 'Export signing secret not configured');
	let payload: string;
	try {
		payload = atob(payloadB64);
	} catch {
		error(400, 'Invalid token encoding');
	}

	const isValid = await verifyExportToken(payload, sig, tokenSecret);
	if (!isValid) error(403, 'Invalid token signature');

	let token: { key: string; exp: number; uid: string };
	try {
		token = JSON.parse(payload);
	} catch {
		error(400, 'Invalid token payload');
	}

	// Validate expiry
	if (Date.now() > token.exp) {
		error(410, 'Download link has expired');
	}

	// Validate ownership
	if (token.uid !== locals.user.id) {
		error(403, 'This download link belongs to a different user');
	}

	// Validate key format (must start with exports/)
	if (!token.key.startsWith('exports/')) {
		error(400, 'Invalid export key');
	}

	const object = await r2.get(token.key);
	if (!object) error(404, 'Export file not found or expired');

	const filename = token.key.split('/').pop() || 'export.zip';

	return new Response(object.body as ReadableStream, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'private, no-cache'
		}
	});
};
