<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	const statusLabels: Record<string, () => string> = {
		all: m.ticket_status_all,
		open: m.ticket_status_open,
		in_progress: m.ticket_status_in_progress,
		resolved: m.ticket_status_resolved,
		closed: m.ticket_status_closed
	};
	const statuses = Object.keys(statusLabels);

	function setFilter(status: string) {
		const url = new URL($page.url);
		if (status === 'all') {
			url.searchParams.delete('status');
		} else {
			url.searchParams.set('status', status);
		}
		goto(url.toString(), { replaceState: true });
	}

	function statusColor(status: string) {
		switch (status) {
			case 'open':
				return 'status-open';
			case 'in_progress':
				return 'status-progress';
			case 'resolved':
				return 'status-resolved';
			case 'closed':
				return 'status-closed';
			default:
				return '';
		}
	}

	async function updateStatus(ticketId: string, newStatus: string) {
		const res = await fetch(`/api/support/tickets/${ticketId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: newStatus })
		});
		if (res.ok) {
			const ticket = data.tickets.find((t: any) => t.id === ticketId);
			if (ticket) ticket.status = newStatus;
		}
	}
</script>

<div class="tickets-page">
	<h1 class="page-title">{m.admin_tickets()}</h1>

	<div class="filters" data-testid="ticket-filters">
		{#each statuses as s}
			<button
				class="filter-btn"
				class:active={(s === 'all' && !data.statusFilter) || s === data.statusFilter}
				onclick={() => setFilter(s)}
			>
				{statusLabels[s]()}
			</button>
		{/each}
	</div>

	<div class="table-wrap">
		<table class="data-table" data-testid="tickets-table">
			<thead>
				<tr>
					<th>{m.ticket_title()}</th>
					<th>{m.ticket_category()}</th>
					<th>{m.ticket_status()}</th>
					<th>{m.ticket_submitted_by()}</th>
					<th>{m.ticket_created()}</th>
					<th>{m.ticket_actions()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.tickets as ticket (ticket.id)}
					<tr>
						<td>
							<a href="/admin/tickets/{ticket.id}" class="ticket-link" data-testid={`ticket-${ticket.id}`}>
								{ticket.title}
							</a>
						</td>
						<td>
							<span class="category-badge">{ticket.category}</span>
						</td>
						<td>
							<span class="status-badge {statusColor(ticket.status)}">
								{ticket.status.replace('_', ' ')}
							</span>
						</td>
						<td class="cell-muted">{ticket.userName || '—'}</td>
						<td class="cell-date">
							{ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : '—'}
						</td>
						<td>
							{#if ticket.status === 'open'}
								<button class="action-btn" onclick={() => updateStatus(ticket.id, 'in_progress')}>
									{m.ticket_start()}
								</button>
							{:else if ticket.status === 'in_progress'}
								<button class="action-btn" onclick={() => updateStatus(ticket.id, 'resolved')}>
									{m.ticket_resolve()}
								</button>
							{:else if ticket.status === 'resolved'}
								<button class="action-btn" onclick={() => updateStatus(ticket.id, 'closed')}>
									{m.ticket_close()}
								</button>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="empty-row">{m.ticket_empty()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="pagination">
		<span class="total">{m.admin_total_count({ count: data.total })}</span>
	</div>
</div>

<style>
	.tickets-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.page-title {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
	}

	.filters {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.filter-btn {
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: transparent;
		color: var(--fg-muted);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.filter-btn:hover {
		background: var(--hover);
		color: var(--fg);
	}

	.filter-btn.active {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
	}

	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 8px;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.data-table th {
		text-align: left;
		padding: 0.75rem 1rem;
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-muted);
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}

	.data-table td {
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--border);
	}

	.data-table tbody tr:last-child td {
		border-bottom: none;
	}

	.data-table tbody tr:hover {
		background: var(--hover);
	}

	.ticket-link {
		color: var(--fg);
		text-decoration: none;
		font-weight: 500;
	}

	.ticket-link:hover {
		text-decoration: underline;
		color: var(--accent);
	}

	.category-badge {
		font-size: 0.75rem;
		color: var(--fg-muted);
		font-family: monospace;
	}

	.status-badge {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: capitalize;
	}

	.status-open {
		background: rgba(59, 130, 246, 0.1);
		color: #3b82f6;
	}

	.status-progress {
		background: rgba(234, 179, 8, 0.1);
		color: #eab308;
	}

	.status-resolved {
		background: rgba(34, 197, 94, 0.1);
		color: #22c55e;
	}

	.status-closed {
		background: var(--surface);
		color: var(--fg-muted);
	}

	.cell-muted {
		color: var(--fg-muted);
	}

	.cell-date {
		color: var(--fg-muted);
		font-size: 0.8rem;
	}

	.action-btn {
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: transparent;
		color: var(--fg-muted);
		font-size: 0.78rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.action-btn:hover {
		background: var(--hover);
		color: var(--fg);
	}

	.empty-row {
		text-align: center;
		color: var(--fg-muted);
		padding: 2rem 1rem !important;
	}

	.pagination {
		display: flex;
		justify-content: flex-end;
	}

	.total {
		font-size: 0.8rem;
		color: var(--fg-muted);
	}
</style>
