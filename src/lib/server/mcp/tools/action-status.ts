import { eq, and } from 'drizzle-orm';
import { pendingActions } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ActionStatusResult, McpResponse } from '$lib/types/mcp';

export async function actionStatus(
	params: { action_id: number },
	agent: AgentContext,
	db: any
): Promise<McpResponse<ActionStatusResult>> {
	const [action] = await db
		.select({
			id: pendingActions.id,
			status: pendingActions.status,
			actionType: pendingActions.actionType,
			riskLevel: pendingActions.riskLevel,
			description: pendingActions.description,
			createdAt: pendingActions.createdAt,
			approvedBy: pendingActions.approvedBy,
			approvedAt: pendingActions.approvedAt
		})
		.from(pendingActions)
		.where(
			and(
				eq(pendingActions.id, params.action_id),
				eq(pendingActions.orgId, agent.orgId),
				eq(pendingActions.agentUserId, agent.agentUserId)
			)
		)
		.limit(1);

	if (!action) {
		return { ok: false, error: 'Action not found', code: 'action_not_found' };
	}

	return {
		ok: true,
		data: {
			action_id: action.id,
			status: action.status,
			action_type: action.actionType,
			risk_level: action.riskLevel,
			description: action.description,
			created_at: action.createdAt.toISOString(),
			approved_by: action.approvedBy,
			approved_at: action.approvedAt?.toISOString() ?? null
		}
	};
}
