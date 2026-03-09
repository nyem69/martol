import { eq, and } from 'drizzle-orm';
import { organization } from '$lib/server/db/auth-schema';
import { projectBrief } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { BriefGetResult, McpResponse } from '$lib/types/mcp';

export async function briefGetActive(
	agent: AgentContext,
	db: any
): Promise<McpResponse<BriefGetResult>> {
	// Try project_brief table first (active row)
	const [activeBrief] = await db
		.select({ content: projectBrief.content, version: projectBrief.version })
		.from(projectBrief)
		.where(and(eq(projectBrief.orgId, agent.orgId), eq(projectBrief.status, 'active')))
		.limit(1);

	if (activeBrief) {
		return {
			ok: true,
			data: {
				brief: activeBrief.content,
				room_id: agent.orgId,
				version: activeBrief.version
			}
		};
	}

	// Fallback: organization.metadata
	let brief: string | null = null;
	const [org] = await db
		.select({ metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, agent.orgId))
		.limit(1);

	if (org?.metadata) {
		try {
			const meta = typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata;
			brief = meta?.brief ?? null;
		} catch { /* ignore invalid JSON */ }
	}

	return {
		ok: true,
		data: {
			brief,
			room_id: agent.orgId,
			version: 0
		}
	};
}
