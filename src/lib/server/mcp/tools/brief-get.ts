import { getActiveBrief } from '$lib/server/db/brief';
import type { AgentContext } from '../auth';
import type { BriefGetResult, McpResponse } from '$lib/types/mcp';

export async function briefGetActive(
	agent: AgentContext,
	db: any,
	kv?: KVNamespace
): Promise<McpResponse<BriefGetResult>> {
	const brief = await getActiveBrief(db, agent.orgId, kv);

	return {
		ok: true,
		data: {
			brief: brief.content,
			room_id: agent.orgId,
			version: brief.version
		}
	};
}
