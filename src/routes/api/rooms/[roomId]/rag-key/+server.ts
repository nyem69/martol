/**
 * RAG API Key Management — Martol
 *
 * PUT    /api/rooms/[roomId]/rag-key — Store API key (owner only)
 * DELETE /api/rooms/[roomId]/rag-key — Remove API key (owner only)
 * GET    /api/rooms/[roomId]/rag-key — Check if key exists, masked (any authed user)
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { member } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';

/** Verify the caller is an owner of the given org/room. */
async function requireOwner(db: App.Locals['db'], userId: string, orgId: string) {
	if (!db) error(503, 'Database unavailable');

	const [memberRecord] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
		.limit(1);

	if (!memberRecord || memberRecord.role !== 'owner') {
		error(403, 'Only room owners can manage API keys');
	}
}

function getKV(platform: App.Platform | undefined): KVNamespace {
	const kv = platform?.env?.CACHE;
	if (!kv) error(503, 'KV storage unavailable');
	return kv;
}

// ── PUT — store API key ─────────────────────────────────────────────

export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = params.roomId;
	await requireOwner(locals.db, locals.user.id, orgId);

	let body: { apiKey: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	if (typeof body.apiKey !== 'string' || body.apiKey.length < 10 || body.apiKey.length > 500) {
		error(400, 'Invalid API key');
	}

	const kv = getKV(platform);
	const keyId = `org-${orgId}`;
	await kv.put(`rag-key:${keyId}`, body.apiKey);

	return json({ ok: true, keyId, masked: `...${body.apiKey.slice(-4)}` });
};

// ── DELETE — remove API key ─────────────────────────────────────────

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = params.roomId;
	await requireOwner(locals.db, locals.user.id, orgId);

	const kv = getKV(platform);
	const keyId = `org-${orgId}`;
	await kv.delete(`rag-key:${keyId}`);

	return json({ ok: true });
};

// ── GET — check if key exists (masked) ──────────────────────────────

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');

	const kv = platform?.env?.CACHE;
	if (!kv) return json({ hasKey: false });

	const keyId = `org-${params.roomId}`;
	const key = await kv.get(`rag-key:${keyId}`);

	return json({
		hasKey: !!key,
		keyId: key ? keyId : null,
		masked: key ? `...${key.slice(-4)}` : null
	});
};
