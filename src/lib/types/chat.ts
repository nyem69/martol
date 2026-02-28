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
}

export interface MentionUser {
	id: string;
	name: string;
}
