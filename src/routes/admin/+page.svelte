<script lang="ts">
	import { Users, MessageSquare, Bot, TicketCheck, Building2 } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	// svelte-ignore state_referenced_locally — intentional: stats are stable from server load
	const stats = data.stats;
</script>

<div class="dashboard">
	<h1 class="page-title">{m.admin_dashboard()}</h1>

	<div class="stat-grid">
		<div class="stat-card" data-testid="stat-users">
			<div class="stat-icon"><Users size={20} /></div>
			<div class="stat-value">{stats.totalUsers}</div>
			<div class="stat-label">{m.admin_stat_users()}</div>
		</div>
		<div class="stat-card" data-testid="stat-rooms">
			<div class="stat-icon"><Building2 size={20} /></div>
			<div class="stat-value">{stats.totalRooms}</div>
			<div class="stat-label">{m.admin_stat_rooms()}</div>
		</div>
		<div class="stat-card" data-testid="stat-messages">
			<div class="stat-icon"><MessageSquare size={20} /></div>
			<div class="stat-value">{stats.messagesToday}</div>
			<div class="stat-label">{m.admin_stat_messages_today()}</div>
		</div>
		<div class="stat-card" data-testid="stat-agents">
			<div class="stat-icon"><Bot size={20} /></div>
			<div class="stat-value">{stats.activeAgents}</div>
			<div class="stat-label">{m.admin_stat_agents()}</div>
		</div>
		<div class="stat-card accent" data-testid="stat-tickets">
			<a href="/admin/tickets?status=open" class="stat-link">
				<div class="stat-icon"><TicketCheck size={20} /></div>
				<div class="stat-value">{stats.openTickets}</div>
				<div class="stat-label">{m.admin_stat_open_tickets()}</div>
			</a>
		</div>
	</div>
</div>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.page-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--fg);
		margin: 0;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 1rem;
	}

	.stat-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.stat-card.accent {
		border-color: var(--accent);
	}

	.stat-icon {
		color: var(--fg-muted);
	}

	.stat-card.accent .stat-icon {
		color: var(--accent);
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1;
		color: var(--fg);
	}

	.stat-label {
		font-size: 0.8rem;
		color: var(--fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.stat-link {
		text-decoration: none;
		color: inherit;
		display: contents;
	}
</style>
