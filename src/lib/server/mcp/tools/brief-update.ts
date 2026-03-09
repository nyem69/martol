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
	kv?: KVNamespace
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

	// Merge provided fields
	if (params.goal !== undefined) sections.goal = params.goal;
	if (params.stack !== undefined) sections.stack = params.stack;
	if (params.conventions !== undefined) sections.conventions = params.conventions;
	if (params.phase !== undefined) sections.phase = params.phase;
	if (params.notes !== undefined) sections.notes = params.notes;

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

	return { ok: true, data: { version: newVersion } };
}
