/**
 * RAG Config API — Martol
 *
 * GET   /api/rooms/[roomId]/rag-config — Get RAG configuration (any member)
 * PATCH /api/rooms/[roomId]/rag-config — Update RAG configuration (owner/admin only)
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { member } from '$lib/server/db/auth-schema';
import { roomConfig } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { ensureRagUser } from '$lib/server/rag/system-user';
import { checkOrgLimits } from '$lib/server/feature-gates';

const DEFAULTS = {
	ragEnabled: false,
	ragModel: '@cf/meta/llama-3.1-8b-instruct',
	ragTemperature: 0.3,
	ragMaxTokens: 2048,
	ragTrigger: 'explicit' as const,
	ragProvider: 'workers_ai' as const,
	ragBaseUrl: null as string | null,
	ragApiKeyId: null as string | null
};

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

	const [config] = await locals.db
		.select()
		.from(roomConfig)
		.where(eq(roomConfig.orgId, orgId))
		.limit(1);

	if (!config) {
		return json({ ok: true, config: DEFAULTS });
	}

	return json({
		ok: true,
		config: {
			ragEnabled: config.ragEnabled,
			ragModel: config.ragModel,
			ragTemperature: config.ragTemperature,
			ragMaxTokens: config.ragMaxTokens,
			ragTrigger: config.ragTrigger,
			ragProvider: config.ragProvider ?? DEFAULTS.ragProvider,
			ragBaseUrl: config.ragBaseUrl ?? DEFAULTS.ragBaseUrl,
			ragApiKeyId: config.ragApiKeyId ?? DEFAULTS.ragApiKeyId
		}
	});
};

const patchSchema = z.object({
	ragEnabled: z.boolean().optional(),
	ragModel: z.string().max(200).optional(),
	ragTemperature: z.number().min(0).max(2).optional(),
	ragMaxTokens: z.number().int().min(100).max(8192).optional(),
	ragTrigger: z.enum(['explicit', 'always']).optional(),
	ragProvider: z.enum(['workers_ai', 'openai']).optional(),
	ragBaseUrl: z.string().url().max(500).optional().nullable(),
	ragApiKeyId: z.string().max(100).optional().nullable()
});

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = params.roomId;

	// Verify owner/admin
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);
	if (!memberRecord) error(403, 'Not a member of this room');
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'admin') {
		error(403, 'Only owners and admins can change RAG settings');
	}

	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const parsed = patchSchema.safeParse(rawBody);
	if (!parsed.success) {
		error(400, parsed.error.issues.map((i) => i.message).join(', '));
	}
	const body = parsed.data;

	// Validate base URL if provided (SSRF protection)
	if (body.ragBaseUrl) {
		const { validateBaseUrl } = await import('$lib/server/rag/responder');
		if (!validateBaseUrl(body.ragBaseUrl)) {
			error(400, 'Invalid base URL: must be HTTPS and not a private/internal address');
		}
	}

	// Pro-only enforcement: "always" trigger requires Pro plan on the org
	if (body.ragTrigger === 'always') {
		try {
			const orgLimits = await checkOrgLimits(locals.db, orgId, locals.user.id);
			if (orgLimits.plan !== 'pro') {
				error(403, 'The "every message" trigger mode requires a Pro subscription');
			}
		} catch (e) {
			// Re-throw SvelteKit errors (from error() helper)
			if (e && typeof e === 'object' && 'status' in e) throw e;
			// If billing check fails, reject to be safe
			error(403, 'Unable to verify subscription status — "every message" trigger requires Pro');
		}
	}

	// Read existing config for merge and DO notification
	const [existing] = await locals.db
		.select()
		.from(roomConfig)
		.where(eq(roomConfig.orgId, orgId))
		.limit(1);

	const merged = {
		ragEnabled: body.ragEnabled ?? existing?.ragEnabled ?? DEFAULTS.ragEnabled,
		ragModel: body.ragModel ?? existing?.ragModel ?? DEFAULTS.ragModel,
		ragTemperature: body.ragTemperature ?? existing?.ragTemperature ?? DEFAULTS.ragTemperature,
		ragMaxTokens: body.ragMaxTokens ?? existing?.ragMaxTokens ?? DEFAULTS.ragMaxTokens,
		ragTrigger: body.ragTrigger ?? existing?.ragTrigger ?? DEFAULTS.ragTrigger,
		ragProvider: body.ragProvider ?? existing?.ragProvider ?? DEFAULTS.ragProvider,
		ragBaseUrl: body.ragBaseUrl !== undefined ? body.ragBaseUrl : (existing?.ragBaseUrl ?? DEFAULTS.ragBaseUrl),
		ragApiKeyId: body.ragApiKeyId !== undefined ? body.ragApiKeyId : (existing?.ragApiKeyId ?? DEFAULTS.ragApiKeyId)
	};

	// Upsert: INSERT ... ON CONFLICT UPDATE
	await locals.db
		.insert(roomConfig)
		.values({
			orgId,
			ragEnabled: merged.ragEnabled,
			ragModel: merged.ragModel,
			ragTemperature: merged.ragTemperature,
			ragMaxTokens: merged.ragMaxTokens,
			ragTrigger: merged.ragTrigger,
			ragProvider: merged.ragProvider,
			ragBaseUrl: merged.ragBaseUrl,
			ragApiKeyId: merged.ragApiKeyId,
			updatedAt: new Date(),
			updatedBy: locals.user.id
		})
		.onConflictDoUpdate({
			target: roomConfig.orgId,
			set: {
				ragEnabled: merged.ragEnabled,
				ragModel: merged.ragModel,
				ragTemperature: merged.ragTemperature,
				ragMaxTokens: merged.ragMaxTokens,
				ragTrigger: merged.ragTrigger,
				ragProvider: merged.ragProvider,
				ragBaseUrl: merged.ragBaseUrl,
				ragApiKeyId: merged.ragApiKeyId,
				updatedAt: new Date(),
				updatedBy: locals.user.id
			}
		});

	// Ensure RAG system user exists when enabling RAG
	if (merged.ragEnabled) {
		await ensureRagUser(locals.db, orgId);
	}

	// Push full RAG config to the Durable Object (sets this.ragConfig for trigger checks)
	// AND broadcast config change to connected WebSocket clients
	if (platform?.env?.CHAT_ROOM && platform?.env?.HMAC_SIGNING_SECRET) {
		try {
			const doId = platform.env.CHAT_ROOM.idFromName(orgId);
			const stub = platform.env.CHAT_ROOM.get(doId);
			// 1. Push full config to DO (enables/disables RAG trigger in handleChatMessage)
			await stub.fetch(new Request('https://do/notify-rag-config', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': platform.env.HMAC_SIGNING_SECRET
				},
				body: JSON.stringify(merged)
			}));
			// 2. Broadcast change to WS clients (updates UI pill/state)
			await stub.fetch(new Request('https://do/notify-config', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': platform.env.HMAC_SIGNING_SECRET
				},
				body: JSON.stringify({ field: 'rag_enabled', value: merged.ragEnabled, changedBy: locals.user!.id })
			}));
		} catch {
			// Non-critical — DO will be notified on next config change or restart
		}
	}

	return json({ ok: true, config: merged });
};
