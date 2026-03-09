<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Loader, Plus, TicketCheck } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { data } = $props();

	// Form state
	let showForm = $state(false);
	let title = $state('');
	let description = $state('');
	let category = $state('other');
	let submitting = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	const categoryLabels: Record<string, () => string> = {
		bug: m.ticket_cat_bug,
		feature_request: m.ticket_cat_feature_request,
		question: m.ticket_cat_question,
		issue: m.ticket_cat_issue,
		other: m.ticket_cat_other
	};
	const categories = Object.keys(categoryLabels);

	async function handleSubmit() {
		if (submitting) return;
		submitting = true;
		errorMsg = '';
		successMsg = '';

		try {
			const res = await fetch('/api/support/tickets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: title.trim(), description: description.trim(), category })
			});
			const result: any = await res.json();
			if (res.ok && result.ok) {
				successMsg = m.ticket_created_msg();
				// Add to local list
				data.tickets = [
					{
						id: result.data.id,
						title: title.trim(),
						category,
						status: 'open',
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					},
					...data.tickets
				];
				title = '';
				description = '';
				category = 'other';
				showForm = false;
			} else {
				errorMsg = result.error?.message || result.error || m.error_generic();
			}
		} catch {
			errorMsg = m.error_generic();
		} finally {
			submitting = false;
		}
	}

	function statusColor(status: string) {
		switch (status) {
			case 'open': return 'status-open';
			case 'in_progress': return 'status-progress';
			case 'resolved': return 'status-resolved';
			case 'closed': return 'status-closed';
			default: return '';
		}
	}
</script>

<div class="support-page">
	<div class="support-header">
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<button class="back-link" onclick={() => goto('/chat')}>
			<ArrowLeft size={16} />
			{m.settings_back()}
		</button>
			<ThemeToggle />
		</div>
		<div class="header-row">
			<div class="header-left">
				<TicketCheck size={20} />
				<h1 class="page-title">{m.support_title()}</h1>
			</div>
			{#if data.isAdmin}
				<a href="/admin/tickets" class="admin-link">{m.admin_tickets()}</a>
			{/if}
		</div>
	</div>

	{#if errorMsg}
		<div class="error-banner">{errorMsg}</div>
	{/if}
	{#if successMsg}
		<div class="success-banner">{successMsg}</div>
	{/if}

	{#if showForm}
		<div class="ticket-form" data-testid="ticket-form">
			<h2 class="form-title">{m.ticket_new()}</h2>
			<label class="field">
				<span class="field-label">{m.ticket_title()}</span>
				<input
					class="field-input"
					type="text"
					bind:value={title}
					placeholder={m.ticket_title_placeholder()}
					maxlength="200"
				/>
			</label>
			<label class="field">
				<span class="field-label">{m.ticket_category()}</span>
				<select class="field-input" bind:value={category}>
					{#each categories as cat}
						<option value={cat}>{categoryLabels[cat]()}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="field-label">{m.ticket_description()}</span>
				<textarea
					class="field-input"
					bind:value={description}
					placeholder={m.ticket_description_placeholder()}
					rows="5"
				></textarea>
			</label>
			<div class="form-actions">
				<button class="cancel-btn" onclick={() => { showForm = false; }}>
					{m.cancel()}
				</button>
				<button
					class="submit-btn"
					onclick={handleSubmit}
					disabled={submitting || !title.trim() || !description.trim()}
					data-testid="submit-ticket"
				>
					{#if submitting}
						<Loader size={14} class="spin" />
					{:else}
						{m.ticket_submit()}
					{/if}
				</button>
			</div>
		</div>
	{:else}
		<button class="new-ticket-btn" onclick={() => { showForm = true; }} data-testid="new-ticket">
			<Plus size={16} />
			{m.ticket_new()}
		</button>
	{/if}

	<div class="tickets-list">
		<h2 class="section-title">{m.support_my_tickets()} ({data.total})</h2>
		{#each data.tickets as ticket (ticket.id)}
			<a href="/support/{ticket.id}" class="ticket-card" data-testid={`ticket-${ticket.id}`}>
				<div class="ticket-card-header">
					<span class="ticket-card-title">{ticket.title}</span>
					<span class="status-badge {statusColor(ticket.status)}">
						{ticket.status.replace('_', ' ')}
					</span>
				</div>
				<div class="ticket-card-meta">
					<span class="category">{ticket.category}</span>
					<span class="date">{ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : ''}</span>
				</div>
			</a>
		{:else}
			<p class="empty">{m.ticket_empty()}</p>
		{/each}
	</div>
</div>

<style>
	.support-page {
		max-width: 48rem;
		margin: 0 auto;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-height: 100dvh;
		background: var(--bg);
		color: var(--fg);
	}

	.support-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--accent);
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: none;
		color: var(--fg-muted);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0;
	}

	.back-link:hover {
		color: var(--fg);
	}

	.admin-link {
		font-size: 0.8rem;
		color: var(--accent);
		text-decoration: none;
	}

	.admin-link:hover {
		text-decoration: underline;
	}

	.page-title {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
		color: var(--fg);
	}

	.error-banner {
		padding: 0.75rem 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 6px;
		color: #ef4444;
		font-size: 0.85rem;
	}

	.success-banner {
		padding: 0.75rem 1rem;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		border-radius: 6px;
		color: #22c55e;
		font-size: 0.85rem;
	}

	.new-ticket-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 1rem;
		border: 1px dashed var(--border);
		border-radius: 8px;
		background: transparent;
		color: var(--fg-muted);
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s;
		width: 100%;
		justify-content: center;
	}

	.new-ticket-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--hover);
	}

	.ticket-form {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.form-title {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.field-label {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--fg-muted);
	}

	.field-input {
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--fg);
		font-size: 0.85rem;
		font-family: inherit;
	}

	.field-input::placeholder {
		color: var(--fg-muted);
	}

	select.field-input {
		cursor: pointer;
	}

	textarea.field-input {
		resize: vertical;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.cancel-btn {
		padding: 0.45rem 1rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: transparent;
		color: var(--fg-muted);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.cancel-btn:hover {
		background: var(--hover);
		color: var(--fg);
	}

	.submit-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 1rem;
		border: 1px solid var(--accent);
		border-radius: 6px;
		background: var(--accent);
		color: var(--bg);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}

	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.section-title {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 0.5rem;
	}

	.tickets-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ticket-card {
		display: block;
		text-decoration: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		transition: border-color 0.15s;
	}

	.ticket-card:hover {
		border-color: var(--accent);
	}

	.ticket-card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.ticket-card-title {
		font-weight: 500;
		font-size: 0.9rem;
		color: var(--fg);
	}

	.ticket-card-meta {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.3rem;
		font-size: 0.78rem;
	}

	.category {
		color: var(--fg-muted);
		font-family: monospace;
	}

	.date {
		color: var(--fg-muted);
	}

	.status-badge {
		display: inline-block;
		padding: 0.12rem 0.45rem;
		border-radius: 4px;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: capitalize;
		white-space: nowrap;
	}

	.status-open { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
	.status-progress { background: rgba(234, 179, 8, 0.1); color: #eab308; }
	.status-resolved { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
	.status-closed { background: var(--surface); color: var(--fg-muted); border: 1px solid var(--border); }

	.empty {
		text-align: center;
		color: var(--fg-muted);
		font-size: 0.85rem;
		padding: 2rem;
	}

	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
