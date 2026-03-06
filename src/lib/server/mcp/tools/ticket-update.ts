import { eq } from 'drizzle-orm';
import { supportTickets } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { McpResponse } from '$lib/types/mcp';

export async function ticketUpdate(
	params: { ticket_id: string; status?: string; assigned_to?: string[] },
	agent: AgentContext,
	db: any
): Promise<McpResponse<{ id: string; status: string }>> {
	if (!agent.isAdmin) {
		return { ok: false, error: 'Admin access required for ticket_update', code: 'forbidden' };
	}

	const updates: Record<string, unknown> = { updatedAt: new Date() };

	if (params.status) {
		updates.status = params.status;
		if (params.status === 'resolved') {
			updates.resolvedAt = new Date();
			updates.resolvedBy = agent.agentUserId;
		} else if (params.status === 'closed') {
			updates.closedAt = new Date();
			updates.closedBy = agent.agentUserId;
		}
	}

	if (params.assigned_to) {
		updates.assignedTo = params.assigned_to;
	}

	const [updated] = await db
		.update(supportTickets)
		.set(updates)
		.where(eq(supportTickets.id, params.ticket_id))
		.returning({ id: supportTickets.id, status: supportTickets.status });

	if (!updated) {
		return { ok: false, error: 'Ticket not found', code: 'not_found' };
	}

	return { ok: true, data: { id: updated.id, status: updated.status } };
}
