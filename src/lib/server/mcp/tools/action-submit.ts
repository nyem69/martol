import { eq, and } from 'drizzle-orm';
import { messages, pendingActions, agentCursors } from '$lib/server/db/schema';
import { member } from '$lib/server/db/auth-schema';
import type { AgentContext } from '../auth';
import type { ActionSubmitResult, McpResponse } from '$lib/types/mcp';

type ActionType =
	| 'question_answer'
	| 'code_review'
	| 'code_write'
	| 'code_modify'
	| 'code_delete'
	| 'deploy'
	| 'config_change';
type RiskLevel = 'low' | 'medium' | 'high';
type ApprovalOutcome = 'direct' | 'lead_approve' | 'owner_approve' | 'rejected';

function getApprovalOutcome(
	actionType: ActionType,
	riskLevel: RiskLevel,
	senderRole: string
): ApprovalOutcome {
	if (senderRole === 'owner') return 'direct';

	if (riskLevel === 'low') return 'direct';

	if (riskLevel === 'medium') {
		if (senderRole === 'lead') return 'direct';
		if (senderRole === 'member') return 'lead_approve';
		return 'rejected';
	}

	// high risk
	if (senderRole === 'lead') return 'owner_approve';
	if (senderRole === 'member') {
		if (['code_delete', 'deploy', 'config_change'].includes(actionType)) {
			return 'rejected';
		}
		return 'owner_approve';
	}

	return 'rejected';
}

export async function actionSubmit(
	params: {
		action_type: ActionType;
		risk_level: RiskLevel;
		trigger_message_id: number;
		description: string;
		payload?: Record<string, unknown>;
	},
	agent: AgentContext,
	db: any
): Promise<McpResponse<ActionSubmitResult>> {
	// 1. Look up trigger message — server-derive sender identity
	const [triggerMsg] = await db
		.select({
			id: messages.id,
			senderId: messages.senderId,
			senderRole: messages.senderRole,
			orgId: messages.orgId
		})
		.from(messages)
		.where(and(eq(messages.id, params.trigger_message_id), eq(messages.orgId, agent.orgId)))
		.limit(1);

	if (!triggerMsg) {
		return {
			ok: false,
			error: 'Trigger message not found in this room',
			code: 'invalid_trigger'
		};
	}

	// 2. Verify agent cursor has read this message
	const [cursor] = await db
		.select({ lastReadId: agentCursors.lastReadId })
		.from(agentCursors)
		.where(
			and(eq(agentCursors.orgId, agent.orgId), eq(agentCursors.agentUserId, agent.agentUserId))
		)
		.limit(1);

	if (!cursor || cursor.lastReadId < params.trigger_message_id) {
		return {
			ok: false,
			error: 'Agent cursor has not read the trigger message',
			code: 'cursor_behind'
		};
	}

	// 3. Verify triggering user is still an active org member
	const [triggerMember] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, agent.orgId), eq(member.userId, triggerMsg.senderId)))
		.limit(1);

	if (!triggerMember) {
		return {
			ok: false,
			error: 'Triggering user is no longer a room member',
			code: 'sender_removed'
		};
	}

	// 4. Check risk_level × sender_role against the approval matrix
	const outcome = getApprovalOutcome(params.action_type, params.risk_level, triggerMsg.senderRole);

	if (outcome === 'rejected') {
		return {
			ok: false,
			error: `Action ${params.action_type} with risk ${params.risk_level} rejected for role ${triggerMsg.senderRole}`,
			code: 'action_rejected'
		};
	}

	// 5. Insert pending_action with computed status
	const status = outcome === 'direct' ? 'approved' : 'pending';
	const [action] = await db
		.insert(pendingActions)
		.values({
			orgId: agent.orgId,
			triggerMessageId: params.trigger_message_id,
			requestedBy: triggerMsg.senderId,
			requestedRole: triggerMsg.senderRole,
			agentUserId: agent.agentUserId,
			actionType: params.action_type,
			riskLevel: params.risk_level,
			description: params.description,
			payloadJson: params.payload ?? null,
			status,
			approvedBy: outcome === 'direct' ? 'system' : null,
			approvedAt: outcome === 'direct' ? new Date() : null
		})
		.returning({ id: pendingActions.id });

	return {
		ok: true,
		data: { action_id: action.id, status: status as 'approved' | 'pending' }
	};
}
