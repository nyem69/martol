import { desc, eq, and, sql } from 'drizzle-orm';
import { supportTickets } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { McpResponse, TicketListItem } from '$lib/types/mcp';

export async function ticketList(
	params: { status?: string; limit: number },
	agent: AgentContext,
	db: any
): Promise<McpResponse<{ tickets: TicketListItem[]; total: number }>> {
	if (!agent.isAdmin) {
		return { ok: false, error: 'Admin access required for ticket_list', code: 'forbidden' };
	}

	const conditions = [];
	if (params.status) {
		conditions.push(
			eq(
				supportTickets.status,
				params.status as 'open' | 'in_progress' | 'resolved' | 'closed'
			)
		);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const [rows, [{ count }]] = await Promise.all([
		db
			.select({
				id: supportTickets.id,
				title: supportTickets.title,
				category: supportTickets.category,
				status: supportTickets.status,
				createdAt: supportTickets.createdAt
			})
			.from(supportTickets)
			.where(where)
			.orderBy(desc(supportTickets.createdAt))
			.limit(params.limit),
		db.select({ count: sql<number>`count(*)::int` }).from(supportTickets).where(where)
	]);

	return {
		ok: true,
		data: {
			tickets: rows.map((r: any) => ({
				id: r.id,
				title: r.title,
				category: r.category,
				status: r.status,
				created_at: r.createdAt?.toISOString() ?? ''
			})),
			total: count ?? 0
		}
	};
}
