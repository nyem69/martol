import { eq, and } from 'drizzle-orm';
import { pendingActions } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { McpResponse } from '$lib/types/mcp';

interface ActionConfirmResult {
	action_id: number;
	status: 'executed';
	executed_at: string;
}

export async function actionConfirm(
	params: { action_id: number },
	agent: AgentContext,
	db: any
): Promise<McpResponse<ActionConfirmResult>> {
	// Only the agent that submitted the action can confirm execution
	const [action] = await db
		.select({
			id: pendingActions.id,
			status: pendingActions.status
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

	if (action.status !== 'approved') {
		return {
			ok: false,
			error: `Cannot confirm action with status "${action.status}" — only approved actions can be confirmed`,
			code: 'invalid_status'
		};
	}

	const now = new Date();

	// Atomic status transition: approved → executed (TOCTOU guard in WHERE)
	const [updated] = await db
		.update(pendingActions)
		.set({
			status: 'executed' as const,
			executedAt: now
		})
		.where(
			and(
				eq(pendingActions.id, params.action_id),
				eq(pendingActions.status, 'approved')
			)
		)
		.returning({ id: pendingActions.id });

	if (!updated) {
		return { ok: false, error: 'Action status changed concurrently', code: 'conflict' };
	}

	return {
		ok: true,
		data: {
			action_id: updated.id,
			status: 'executed',
			executed_at: now.toISOString()
		}
	};
}
