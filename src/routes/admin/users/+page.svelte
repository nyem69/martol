<script lang="ts">
	import { Shield, ShieldOff, Loader } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let loading = $state<string | null>(null);
	let errorMsg = $state('');

	async function toggleRole(userId: string, currentRole: string) {
		loading = userId;
		errorMsg = '';
		const newRole = currentRole === 'admin' ? 'user' : 'admin';

		try {
			const res = await fetch(`/api/admin/users/${userId}/role`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role: newRole })
			});
			const result: any = await res.json();
			if (!res.ok || !result.ok) {
				errorMsg = result.error?.message || result.error || m.error_generic();
				return;
			}
			// Update local state
			const user = data.users.find((u: any) => u.id === userId);
			if (user) user.role = newRole;
		} catch {
			errorMsg = m.error_generic();
		} finally {
			loading = null;
		}
	}
</script>

<div class="users-page">
	<h1 class="page-title">{m.admin_users()}</h1>

	{#if errorMsg}
		<div class="error-banner">{errorMsg}</div>
	{/if}

	<div class="table-wrap">
		<table class="data-table" data-testid="users-table">
			<thead>
				<tr>
					<th>{m.admin_user_name()}</th>
					<th>{m.admin_user_email()}</th>
					<th>{m.admin_user_username()}</th>
					<th>{m.admin_user_role()}</th>
					<th>{m.admin_user_joined()}</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.users as user (user.id)}
					<tr>
						<td class="cell-name">{user.name}</td>
						<td class="cell-email">{user.email}</td>
						<td class="cell-mono">{user.username || '—'}</td>
						<td>
							<span class="role-badge" class:admin={user.role === 'admin'}>
								{user.role}
							</span>
						</td>
						<td class="cell-date">
							{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
						</td>
						<td>
							<button
								class="toggle-btn"
								class:is-admin={user.role === 'admin'}
								onclick={() => toggleRole(user.id, user.role)}
								disabled={loading === user.id}
								data-testid={`toggle-role-${user.id}`}
							>
								{#if loading === user.id}
									<Loader size={14} class="spin" />
								{:else if user.role === 'admin'}
									<ShieldOff size={14} />
									{m.admin_demote()}
								{:else}
									<Shield size={14} />
									{m.admin_promote()}
								{/if}
							</button>
						</td>
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
	.users-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.page-title {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
	}

	.error-banner {
		padding: 0.75rem 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 6px;
		color: #ef4444;
		font-size: 0.85rem;
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
		color: var(--fg);
	}

	.data-table tbody tr:last-child td {
		border-bottom: none;
	}

	.data-table tbody tr:hover {
		background: var(--hover);
	}

	.cell-name {
		font-weight: 500;
	}

	.cell-email {
		color: var(--fg-muted);
	}

	.cell-mono {
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--fg-muted);
	}

	.cell-date {
		color: var(--fg-muted);
		font-size: 0.8rem;
	}

	.role-badge {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--fg-muted);
	}

	.role-badge.admin {
		background: rgba(234, 179, 8, 0.1);
		border-color: rgba(234, 179, 8, 0.3);
		color: #eab308;
	}

	.toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: transparent;
		color: var(--fg-muted);
		font-size: 0.78rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.toggle-btn:hover {
		background: var(--hover);
		color: var(--fg);
	}

	.toggle-btn.is-admin:hover {
		border-color: rgba(239, 68, 68, 0.3);
		color: #ef4444;
	}

	.toggle-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pagination {
		display: flex;
		justify-content: flex-end;
	}

	.total {
		font-size: 0.8rem;
		color: var(--fg-muted);
	}

	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
