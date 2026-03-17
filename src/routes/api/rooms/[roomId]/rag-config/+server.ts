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

const DEFAULTS = {
	ragEnabled: false,
	ragModel: '@cf/meta/llama-3.1-8b-instruct',
	ragTemperature: 0.3,
	ragMaxTokens: 2048,
	ragTrigger: 'explicit' as const
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
			ragTrigger: config.ragTrigger
		}
	});
};

const patchSchema = z.object({
	ragEnabled: z.boolean().optional(),
	ragModel: z.string().max(200).optional(),
	ragTemperature: z.number().min(0).max(2).optional(),
	ragMaxTokens: z.number().int().min(100).max(8192).optional(),
	ragTrigger: z.enum(['explicit', 'always']).optional()
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

	// TODO: If ragTrigger === 'always', check that the room creator has Pro plan.
	// For now, skip this check — billing integration pending.

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
		ragTrigger: body.ragTrigger ?? existing?.ragTrigger ?? DEFAULTS.ragTrigger
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
				updatedAt: new Date(),
				updatedBy: locals.user.id
			}
		});

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
				body: JSON.stringify({ field: 'rag_enabled', value: merged.ragEnabled, changedBy: locals.user!.id })
			}));
		} catch {
			// Non-critical — client will see update on next page load
		}
	}

	return json({ ok: true, config: merged });
};
