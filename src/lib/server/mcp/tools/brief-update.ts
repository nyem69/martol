import { eq, and, sql, lt } from 'drizzle-orm';
import { organization } from '$lib/server/db/auth-schema';
import { member } from '$lib/server/db/auth-schema';
import { projectBrief } from '$lib/server/db/schema';
import { invalidateBriefCache } from '$lib/server/db/brief';
import { parseBriefContent, serializeBriefSections, type BriefSections } from '$lib/brief-sections';
import { getActiveBrief } from '$lib/server/db/brief';
import type { AgentContext } from '../auth';
import type { BriefUpdateResult, McpResponse } from '$lib/types/mcp';

const MAX_BRIEF_LENGTH = 10_000;
const MAX_ARCHIVED_VERSIONS = 20;

export async function briefUpdate(
	params: { goal?: string; stack?: string; conventions?: string; phase?: string; notes?: string },
	agent: AgentContext,
	db: any,
	kv?: KVNamespace,
	platform?: App.Platform
): Promise<McpResponse<BriefUpdateResult>> {
	// Verify agent has member role or higher
	const [memberRecord] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, agent.orgId), eq(member.userId, agent.agentUserId)))
		.limit(1);

	if (!memberRecord) {
		return { ok: false, error: 'Not a member of this room', code: 'forbidden' };
	}

	// Read current brief and parse sections
	const current = await getActiveBrief(db, agent.orgId, kv);
	const sections: BriefSections = parseBriefContent(current.content);

	// Merge provided fields (skip empty strings — they would erase content)
	let changed = false;
	for (const key of ['goal', 'stack', 'conventions', 'phase', 'notes'] as const) {
		const val = params[key];
		if (val !== undefined && val.trim() !== '') {
			sections[key] = val;
			changed = true;
		}
	}
	if (!changed) {
		return { ok: false, error: 'No non-empty fields provided', code: 'empty_update' };
	}

	const serialized = serializeBriefSections(sections);
	if (serialized.length > MAX_BRIEF_LENGTH) {
		return { ok: false, error: `Brief exceeds ${MAX_BRIEF_LENGTH} characters`, code: 'too_long' };
	}

	// Versioned insert in a transaction
	const newVersion: number = await db.transaction(async (tx: typeof db) => {
		// Lock the org row
		await tx
			.select({ id: organization.id })
			.from(organization)
			.where(eq(organization.id, agent.orgId))
			.for('update');

		// Get current max version
		const [{ maxVersion }] = await tx
			.select({ maxVersion: sql<number>`COALESCE(MAX(${projectBrief.version}), 0)` })
			.from(projectBrief)
			.where(eq(projectBrief.orgId, agent.orgId));

		// Archive current active brief
		await tx
			.update(projectBrief)
			.set({ status: 'archived' })
			.where(and(eq(projectBrief.orgId, agent.orgId), eq(projectBrief.status, 'active')));

		const version = maxVersion + 1;
		await tx.insert(projectBrief).values({
			orgId: agent.orgId,
			content: serialized,
			version,
			status: 'active',
			createdBy: agent.agentUserId
		});

		// Retention cleanup
		if (version > MAX_ARCHIVED_VERSIONS + 1) {
			const cutoff = version - MAX_ARCHIVED_VERSIONS;
			await tx
				.delete(projectBrief)
				.where(
					and(
						eq(projectBrief.orgId, agent.orgId),
						eq(projectBrief.status, 'archived'),
						lt(projectBrief.version, cutoff)
					)
				);
		}

		return version;
	});

	// Invalidate cache
	await invalidateBriefCache(kv, agent.orgId);

	// Broadcast brief_changed to connected WebSocket clients
	if (platform?.env?.CHAT_ROOM && platform?.env?.HMAC_SIGNING_SECRET) {
		try {
			const doId = platform.env.CHAT_ROOM.idFromName(agent.orgId);
			const stub = platform.env.CHAT_ROOM.get(doId);
			await stub.fetch(new Request('https://do/notify-brief', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': platform.env.HMAC_SIGNING_SECRET
				},
				body: JSON.stringify({ version: newVersion, changedBy: agent.agentUserId })
			}));
		} catch {
			// Non-critical — client will see update on next modal open
		}
	}

	return { ok: true, data: { version: newVersion } };
}
