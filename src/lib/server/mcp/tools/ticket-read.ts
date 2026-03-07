import { eq, asc } from 'drizzle-orm';
import { supportTickets, ticketComments } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { McpResponse, TicketDetail } from '$lib/types/mcp';

export async function ticketRead(
	params: { ticket_id: string },
	agent: AgentContext,
	db: any
): Promise<McpResponse<TicketDetail>> {
	if (!agent.isAdmin) {
		return { ok: false, error: 'Admin access required for ticket_read', code: 'forbidden' };
	}

	const [ticket] = await db
		.select({
			id: supportTickets.id,
			userId: supportTickets.userId,
			title: supportTickets.title,
			description: supportTickets.description,
			category: supportTickets.category,
			status: supportTickets.status,
			assignedTo: supportTickets.assignedTo,
			resolvedAt: supportTickets.resolvedAt,
			closedAt: supportTickets.closedAt,
			createdAt: supportTickets.createdAt,
			updatedAt: supportTickets.updatedAt
		})
		.from(supportTickets)
		.where(eq(supportTickets.id, params.ticket_id))
		.limit(1);

	if (!ticket) {
		return { ok: false, error: 'Ticket not found', code: 'not_found' };
	}

	const comments = await db
		.select({
			id: ticketComments.id,
			userId: ticketComments.userId,
			agentUserId: ticketComments.agentUserId,
			content: ticketComments.content,
			createdAt: ticketComments.createdAt
		})
		.from(ticketComments)
		.where(eq(ticketComments.ticketId, params.ticket_id))
		.orderBy(asc(ticketComments.createdAt));

	return {
		ok: true,
		data: {
			id: ticket.id,
			title: ticket.title,
			description: ticket.description,
			category: ticket.category,
			status: ticket.status,
			user_id: ticket.userId,
			assigned_to: ticket.assignedTo ?? null,
			resolved_at: ticket.resolvedAt?.toISOString() ?? null,
			closed_at: ticket.closedAt?.toISOString() ?? null,
			created_at: ticket.createdAt?.toISOString() ?? '',
			updated_at: ticket.updatedAt?.toISOString() ?? '',
			comments: comments.map((c: any) => ({
				id: c.id,
				user_id: c.userId,
				agent_user_id: c.agentUserId,
				content: c.content,
				created_at: c.createdAt?.toISOString() ?? ''
			}))
		}
	};
}
