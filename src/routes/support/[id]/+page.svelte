<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Loader } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let newComment = $state('');
	let submitting = $state(false);
	let errorMsg = $state('');

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

<div class="ticket-page">
	<button class="back-link" onclick={() => goto('/support')}>
		<ArrowLeft size={16} />
		{m.support_title()}
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
	</div>

	<div class="ticket-body">
		<p>{data.ticket.description}</p>
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

		{#if data.ticket.status !== 'closed'}
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
		{/if}
	</div>
</div>

<style>
	.ticket-page {
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

	.back-link:hover { color: var(--fg); }

	.error-banner {
		padding: 0.75rem 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 6px;
		color: #ef4444;
		font-size: 0.85rem;
	}

	.ticket-header { display: flex; flex-direction: column; gap: 0.5rem; }

	.ticket-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.8rem;
	}

	.category { color: var(--fg-muted); font-family: monospace; }
	.date { color: var(--fg-muted); }

	.ticket-title { font-size: 1.35rem; font-weight: 600; margin: 0; }

	.ticket-body {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.25rem;
		font-size: 0.9rem;
		line-height: 1.6;
		white-space: pre-wrap;
	}

	.ticket-body p { margin: 0; }

	.comments-section { display: flex; flex-direction: column; gap: 0.75rem; }
	.section-title { font-size: 1rem; font-weight: 600; margin: 0; }

	.comment {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.75rem 1rem;
	}

	.comment-header { display: flex; justify-content: space-between; margin-bottom: 0.35rem; }
	.comment-author { font-weight: 500; font-size: 0.85rem; }
	.comment-date { font-size: 0.75rem; color: var(--fg-muted); }
	.comment-body { margin: 0; font-size: 0.85rem; line-height: 1.5; white-space: pre-wrap; }
	.empty-comments { color: var(--fg-muted); font-size: 0.85rem; text-align: center; padding: 1rem; }

	.comment-form { display: flex; flex-direction: column; gap: 0.5rem; }

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

	.comment-input::placeholder { color: var(--fg-muted); }

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

	.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.status-badge {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: capitalize;
	}

	.status-open { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
	.status-progress { background: rgba(234, 179, 8, 0.1); color: #eab308; }
	.status-resolved { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
	.status-closed { background: var(--surface); color: var(--fg-muted); }

	:global(.spin) { animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
