import { eq } from 'drizzle-orm';
import { supportTickets, ticketComments } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { McpResponse } from '$lib/types/mcp';

export async function ticketComment(
	params: { ticket_id: string; content: string },
	agent: AgentContext,
	db: any
): Promise<McpResponse<{ comment_id: string }>> {
	if (!agent.isAdmin) {
		return { ok: false, error: 'Admin access required for ticket_comment', code: 'forbidden' };
	}

	// Verify ticket exists
	const [ticket] = await db
		.select({ id: supportTickets.id })
		.from(supportTickets)
		.where(eq(supportTickets.id, params.ticket_id))
		.limit(1);

	if (!ticket) {
		return { ok: false, error: 'Ticket not found', code: 'not_found' };
	}

	const id = crypto.randomUUID().replace(/-/g, '').slice(0, 21);

	await db.insert(ticketComments).values({
		id,
		ticketId: params.ticket_id,
		agentUserId: agent.agentUserId,
		content: params.content
	});

	return { ok: true, data: { comment_id: id } };
}
