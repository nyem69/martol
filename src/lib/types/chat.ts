/**
 * Chat UI Types — Martol
 *
 * Shared types for chat components.
 */

export interface PendingAction {
	id: number;
	actionType: string;
	riskLevel: 'low' | 'medium' | 'high';
	description: string;
	requestedBy: string;
	requestedRole: string;
	agentName: string;
	status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';
	timestamp: string;
	simulationType: string | null;
	simulationPayload: Record<string, unknown> | null;
	riskFactors: { factor: string; severity: string; detail: string }[] | null;
	estimatedImpact: { files_modified?: number; services_affected?: string[]; reversible?: boolean } | null;
}

export interface MentionUser {
	id: string;
	name: string;
}
