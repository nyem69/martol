import { eq, and, isNull } from 'drizzle-orm';
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

/** Server-authoritative risk mapping — never trust agent-supplied risk_level */
const ACTION_RISK_MAP: Record<ActionType, RiskLevel> = {
	question_answer: 'low',
	code_review: 'low',
	code_write: 'medium',
	code_modify: 'high',
	code_delete: 'high',
	deploy: 'high',
	config_change: 'high'
};

function getApprovalOutcome(
	actionType: ActionType,
	riskLevel: RiskLevel,
	senderRole: string
): ApprovalOutcome {
	if (senderRole === 'viewer') return 'rejected';
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
		simulation?: {
			type: 'code_diff' | 'shell_preview' | 'api_call' | 'file_ops' | 'custom';
			preview: Record<string, unknown>;
			impact?: {
				files_modified?: number;
				services_affected?: string[];
				reversible?: boolean;
			};
			risk_factors?: { factor: string; severity: string; detail: string }[];
		};
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
		.where(and(eq(messages.id, params.trigger_message_id), eq(messages.orgId, agent.orgId), isNull(messages.deletedAt)))
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

	// 4. Server-derive risk level — never trust agent's claimed value
	let serverRisk: RiskLevel = ACTION_RISK_MAP[params.action_type];

	// 4a. Validate simulation payload size (prevent memory exhaustion from oversized diffs)
	if (params.simulation?.preview) {
		const payloadStr = JSON.stringify(params.simulation.preview);
		if (payloadStr.length > 100_000) {
			return {
				ok: false,
				error: 'Simulation preview payload too large (max 100KB)',
				code: 'payload_too_large'
			};
		}
	}

	// 4b. Augment risk based on simulation impact (irreversible actions are riskier).
	// Note: agents can bypass this by omitting `reversible`. This is acceptable because
	// the augmentation only escalates risk (never reduces), and the base ACTION_RISK_MAP
	// is already server-authoritative. Agents gain nothing by bypassing the escalation.
	if (params.simulation?.impact?.reversible === false) {
		if (serverRisk === 'low') serverRisk = 'medium';
		else if (serverRisk === 'medium') serverRisk = 'high';
	}

	const outcome = getApprovalOutcome(params.action_type, serverRisk, triggerMsg.senderRole);

	if (outcome === 'rejected') {
		return {
			ok: false,
			error: `Action ${params.action_type} with risk ${serverRisk} rejected for role ${triggerMsg.senderRole}`,
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
			riskLevel: serverRisk,
			description: params.description,
			payloadJson: {
				...(params.payload ?? {}),
				_claimed_risk_level: params.risk_level
			},
			simulationType: params.simulation?.type ?? null,
			simulationPayload: params.simulation?.preview ?? null,
			riskFactors: params.simulation?.risk_factors ?? null,
			estimatedImpact: params.simulation?.impact ?? null,
			status,
			approvedBy: outcome === 'direct' ? 'system' : null,
			approvedAt: outcome === 'direct' ? new Date() : null
		})
		.returning({ id: pendingActions.id });

	return {
		ok: true,
		data: { action_id: action.id, status: status as 'approved' | 'pending', server_risk: serverRisk }
	};
}
