<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Loader } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let newComment = $state('');
	let submitting = $state(false);
	let statusLoading = $state(false);
	let errorMsg = $state('');

	async function changeStatus(newStatus: string) {
		statusLoading = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/support/tickets/${data.ticket.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus })
			});
			if (res.ok) {
				data.ticket.status = newStatus;
			} else {
				const r: any = await res.json();
				errorMsg = r.error?.message || m.error_generic();
			}
		} catch {
			errorMsg = m.error_generic();
		} finally {
			statusLoading = false;
		}
	}

	async function addComment() {
		if (!newComment.trim() || submitting) return;
		submitting = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/support/tickets/${data.ticket.id}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: newComment.trim() })
			});
			const result: any = await res.json();
			if (res.ok && result.ok) {
				data.comments = [
					...data.comments,
					{
						id: result.data.id,
						userId: null,
						agentUserId: null,
						userName: 'You',
						content: newComment.trim(),
						parentId: null,
						createdAt: new Date().toISOString()
					}
				];
				newComment = '';
			} else {
				errorMsg = result.error?.message || m.error_generic();
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

<div class="ticket-detail">
	<button class="back-link" onclick={() => goto('/admin/tickets')}>
		<ArrowLeft size={16} />
		{m.admin_tickets()}
	</button>

	{#if errorMsg}
		<div class="error-banner">{errorMsg}</div>
	{/if}

	<div class="ticket-header">
		<div class="ticket-meta">
			<span class="status-badge {statusColor(data.ticket.status)}">
				{data.ticket.status.replace('_', ' ')}
			</span>
			<span class="category">{data.ticket.category}</span>
			<span class="date">{data.ticket.createdAt ? new Date(data.ticket.createdAt).toLocaleString() : ''}</span>
		</div>
		<h1 class="ticket-title">{data.ticket.title}</h1>
		<p class="ticket-author">{m.ticket_submitted_by()}: {data.ticket.userName || data.ticket.userId}</p>
	</div>

	<div class="ticket-body">
		<p>{data.ticket.description}</p>
	</div>

	<div class="status-actions" data-testid="status-actions">
		{#if data.ticket.status === 'open'}
			<button class="status-btn" onclick={() => changeStatus('in_progress')} disabled={statusLoading}>
				{m.ticket_start()}
			</button>
		{:else if data.ticket.status === 'in_progress'}
			<button class="status-btn" onclick={() => changeStatus('resolved')} disabled={statusLoading}>
				{m.ticket_resolve()}
			</button>
		{:else if data.ticket.status === 'resolved'}
			<button class="status-btn" onclick={() => changeStatus('closed')} disabled={statusLoading}>
				{m.ticket_close()}
			</button>
		{/if}
		{#if data.ticket.status !== 'open' && data.ticket.status !== 'closed'}
			<button class="status-btn secondary" onclick={() => changeStatus('open')} disabled={statusLoading}>
				{m.ticket_reopen()}
			</button>
		{/if}
	</div>

	<div class="comments-section">
		<h2 class="section-title">{m.ticket_comments()} ({data.comments.length})</h2>

		{#each data.comments as comment (comment.id)}
			<div class="comment">
				<div class="comment-header">
					<span class="comment-author">
						{comment.userName || (comment.agentUserId ? 'Agent' : 'User')}
					</span>
					<span class="comment-date">
						{comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ''}
					</span>
				</div>
				<p class="comment-body">{comment.content}</p>
			</div>
		{:else}
			<p class="empty-comments">{m.ticket_no_comments()}</p>
		{/each}

		<div class="comment-form" data-testid="comment-form">
			<textarea
				class="comment-input"
				bind:value={newComment}
				placeholder={m.ticket_comment_placeholder()}
				rows="3"
			></textarea>
			<button
				class="submit-btn"
				onclick={addComment}
				disabled={submitting || !newComment.trim()}
				data-testid="submit-comment"
			>
				{#if submitting}
					<Loader size={14} class="spin" />
				{:else}
					{m.ticket_add_comment()}
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.ticket-detail {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		max-width: 48rem;
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

	.error-banner {
		padding: 0.75rem 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 6px;
		color: #ef4444;
		font-size: 0.85rem;
	}

	.ticket-header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ticket-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.8rem;
	}

	.category {
		color: var(--fg-muted);
		font-family: monospace;
	}

	.date {
		color: var(--fg-muted);
	}

	.ticket-title {
		font-size: 1.35rem;
		font-weight: 600;
		margin: 0;
	}

	.ticket-author {
		font-size: 0.85rem;
		color: var(--fg-muted);
		margin: 0;
	}

	.ticket-body {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.25rem;
		font-size: 0.9rem;
		line-height: 1.6;
		white-space: pre-wrap;
	}

	.ticket-body p {
		margin: 0;
	}

	.status-actions {
		display: flex;
		gap: 0.5rem;
	}

	.status-btn {
		padding: 0.45rem 1rem;
		border: 1px solid var(--accent);
		border-radius: 6px;
		background: var(--accent);
		color: var(--bg);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.status-btn:hover {
		opacity: 0.85;
	}

	.status-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.status-btn.secondary {
		background: transparent;
		color: var(--fg-muted);
		border-color: var(--border);
	}

	.status-btn.secondary:hover {
		background: var(--hover);
		color: var(--fg);
	}

	.comments-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-title {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
	}

	.comment {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.75rem 1rem;
	}

	.comment-header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.35rem;
	}

	.comment-author {
		font-weight: 500;
		font-size: 0.85rem;
	}

	.comment-date {
		font-size: 0.75rem;
		color: var(--fg-muted);
	}

	.comment-body {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.empty-comments {
		color: var(--fg-muted);
		font-size: 0.85rem;
		text-align: center;
		padding: 1rem;
	}

	.comment-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.comment-input {
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		color: var(--fg);
		font-size: 0.85rem;
		font-family: inherit;
		resize: vertical;
	}

	.comment-input::placeholder {
		color: var(--fg-muted);
	}

	.submit-btn {
		align-self: flex-end;
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

	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
