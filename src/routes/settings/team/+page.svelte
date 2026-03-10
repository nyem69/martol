<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Users, Crown, Plus, Trash2, Loader, CreditCard } from '@lucide/svelte';

	let { data } = $props();

	interface TeamData {
		id: string;
		name: string;
		status: string;
		seats: number;
		memberCount: number;
		currentPeriodEnd: string | null;
		cancelAtPeriodEnd: boolean;
	}

	interface MemberData {
		id: string;
		userId: string;
		displayName: string;
		username: string;
		email: string;
		assignedAt: string;
	}

	let team = $state<TeamData | null>(null);
	let members = $state<MemberData[]>([]);
	let loading = $state(true);
	let error = $state('');
	let teamName = $state('');
	let teamSeats = $state(5);
	let createLoading = $state(false);
	let addEmail = $state('');
	let addLoading = $state(false);

	type ApiError = { error?: string };

	function extractError(body: unknown, fallback: string): string {
		if (body && typeof body === 'object' && 'error' in body) {
			return (body as ApiError).error ?? fallback;
		}
		return fallback;
	}

	async function loadTeam() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/billing/team');
			if (res.ok) {
				const body = (await res.json()) as { team?: TeamData; members?: MemberData[] };
				team = body.team ?? null;
				members = body.members ?? [];
			} else if (res.status === 404) {
				team = null;
				members = [];
			} else {
				const body: unknown = await res.json().catch(() => ({}));
				error = extractError(body, 'Failed to load team data.');
			}
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			loading = false;
		}
	}

	async function createTeam() {
		if (!teamName.trim()) return;
		createLoading = true;
		error = '';
		try {
			const res = await fetch('/api/billing/team/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: teamName.trim(), seats: teamSeats })
			});
			if (res.ok) {
				const body = (await res.json()) as { url?: string };
				if (body.url) window.location.href = body.url;
			} else {
				const body: unknown = await res.json().catch(() => ({}));
				error = extractError(body, 'Failed to start checkout.');
			}
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			createLoading = false;
		}
	}

	async function addMember() {
		if (!addEmail.trim()) return;
		addLoading = true;
		error = '';
		try {
			const res = await fetch('/api/billing/team/members', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: addEmail.trim() })
			});
			if (res.ok) {
				addEmail = '';
				await loadTeam();
			} else {
				const body: unknown = await res.json().catch(() => ({}));
				error = extractError(body, 'Failed to add member.');
			}
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			addLoading = false;
		}
	}

	async function removeMember(userId: string) {
		error = '';
		try {
			const res = await fetch('/api/billing/team/members', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (res.ok) {
				await loadTeam();
			} else {
				const body: unknown = await res.json().catch(() => ({}));
				error = extractError(body, 'Failed to remove member.');
			}
		} catch {
			error = 'Network error. Please try again.';
		}
	}

	async function openTeamPortal() {
		error = '';
		try {
			const res = await fetch('/api/billing/team/portal', { method: 'POST' });
			if (res.ok) {
				const body = (await res.json()) as { url?: string };
				if (body.url) window.location.href = body.url;
			} else {
				const body: unknown = await res.json().catch(() => ({}));
				error = extractError(body, 'Failed to open billing portal.');
			}
		} catch {
			error = 'Network error. Please try again.';
		}
	}

	$effect(() => {
		loadTeam();
	});

	const isActive = $derived(team !== null && team.status === 'active');
	const hasAvailableSeats = $derived(
		isActive && (team?.memberCount ?? 0) < (team?.seats ?? 0)
	);

	function formatDate(dateStr: string | null) {
		if (!dateStr) return '—';
		return new Date(dateStr).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<div class="team-shell">
	<div class="team-content">
		<!-- Back link -->
		<button
			class="back-link"
			onclick={() => goto('/settings')}
			data-testid="back-to-settings"
		>
			<ArrowLeft size={16} />
			Back to Settings
		</button>

		<!-- Header -->
		<div class="page-header">
			<div class="header-icon">
				<Users size={20} />
			</div>
			<div>
				<h1>Team</h1>
				<p class="subtitle">Manage your team subscription and members</p>
			</div>
		</div>

		<!-- Error -->
		{#if error}
			<div class="error-bar" data-testid="team-error">
				{error}
			</div>
		{/if}

		<!-- Loading -->
		{#if loading}
			<div class="loading-center">
				<Loader size={24} class="spin" />
			</div>

		<!-- No team: create form -->
		{:else if !team}
			<div class="card">
				<div class="card-header">
					<Crown size={20} />
					<h2>Create a Team</h2>
				</div>
				<p class="card-desc">
					A team subscription lets you assign Pro status to multiple users under one invoice.
					Each seat costs <strong>$10/user/month</strong>.
				</p>

				<div class="form-stack">
					<div class="form-group">
						<label for="team-name">Team name</label>
						<input
							id="team-name"
							type="text"
							placeholder="Acme Corp"
							bind:value={teamName}
							data-testid="team-name-input"
						/>
					</div>

					<div class="form-group">
						<label for="team-seats">Number of seats</label>
						<input
							id="team-seats"
							type="number"
							min="1"
							max="500"
							bind:value={teamSeats}
							data-testid="team-seats-input"
						/>
						<span class="hint">Total: <strong>${teamSeats * 10}/month</strong></span>
					</div>

					<button
						class="btn-primary full-width"
						onclick={createTeam}
						disabled={createLoading || !teamName.trim()}
						data-testid="create-team-button"
					>
						{#if createLoading}
							<Loader size={16} class="spin" />
							Redirecting to checkout…
						{:else}
							<CreditCard size={16} />
							Continue to Checkout
						{/if}
					</button>
				</div>
			</div>

		<!-- Team exists -->
		{:else}
			<!-- Team info card -->
			<div class="card">
				<div class="team-info-row">
					<div>
						<div class="team-name-row">
							<Crown size={16} />
							<span class="team-name">{team.name}</span>
							<span class="status-badge" class:active={isActive} class:canceling={isActive && team.cancelAtPeriodEnd}>
								{#if isActive && team.cancelAtPeriodEnd}
									cancels {formatDate(team.currentPeriodEnd)}
								{:else}
									{team.status}
								{/if}
							</span>
						</div>
						<p class="seats-text">
							{team.memberCount} / {team.seats} seats used
						</p>
						{#if team.currentPeriodEnd && !team.cancelAtPeriodEnd}
							<p class="renewal-text">
								Renews {formatDate(team.currentPeriodEnd)}
							</p>
						{/if}
					</div>

					<button
						class="btn-secondary"
						onclick={openTeamPortal}
						data-testid="manage-billing-button"
					>
						<CreditCard size={14} />
						Manage Billing
					</button>
				</div>

				<!-- Seat usage bar -->
				<div class="seats-bar">
					<div
						class="seats-fill"
						style="width: {Math.min(100, (team.memberCount / team.seats) * 100)}%"
					></div>
				</div>
			</div>

			<!-- Add member form -->
			<div class="card">
				<h2 class="section-title">Add Member</h2>
				{#if !isActive}
					<p class="card-desc">
						Team subscription must be active to add members.
					</p>
				{:else if !hasAvailableSeats}
					<p class="card-desc">
						All {team.seats} seats are filled. Increase seats via the billing portal.
					</p>
				{:else}
					<div class="add-row">
						<input
							type="email"
							placeholder="member@example.com"
							bind:value={addEmail}
							data-testid="add-member-email-input"
						/>
						<button
							class="btn-primary"
							onclick={addMember}
							disabled={addLoading || !addEmail.trim()}
							data-testid="add-member-button"
						>
							{#if addLoading}
								<Loader size={16} class="spin" />
							{:else}
								<Plus size={16} />
							{/if}
							Add
						</button>
					</div>
				{/if}
			</div>

			<!-- Members list -->
			<div class="card no-pad">
				<div class="members-header">
					<h2 class="section-title">
						Members
						<span class="count">({members.length})</span>
					</h2>
				</div>

				{#if members.length === 0}
					<div class="empty-state">
						No members yet. Add someone above.
					</div>
				{:else}
					<ul class="members-list">
						{#each members as m (m.id)}
							<li class="member-row" data-testid="member-row">
								<div>
									<p class="member-name">
										{m.displayName || m.username || m.email}
									</p>
									<p class="member-email">{m.email}</p>
								</div>
								{#if m.userId !== data.userId}
									<button
										class="btn-remove"
										onclick={() => removeMember(m.userId)}
										data-testid="remove-member-button"
									>
										<Trash2 size={14} />
										Remove
									</button>
								{:else}
									<span class="you-badge">You</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* ── Shell ──────────────────────────────────────── */
	.team-shell {
		min-height: 100dvh;
		background: var(--bg);
		color: var(--text);
		overflow-y: auto;
	}

	.team-content {
		max-width: 640px;
		margin: 0 auto;
		padding: 40px 24px 120px;
	}

	/* ── Back link ──────────────────────────────────── */
	.back-link {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--text-muted);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		margin-bottom: 32px;
		transition: color 0.12s;
	}

	.back-link:hover {
		color: var(--text);
	}

	/* ── Page header ───────────────────────────────── */
	.page-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 32px;
	}

	.header-icon {
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		background: color-mix(in oklch, var(--accent) 12%, transparent);
		color: var(--accent);
	}

	.page-header h1 {
		font-family: var(--font-mono-alt);
		font-size: 20px;
		font-weight: 600;
		margin: 0;
	}

	.subtitle {
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--text-muted);
		margin: 2px 0 0;
	}

	/* ── Error ─────────────────────────────────────── */
	.error-bar {
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--danger);
		background: color-mix(in oklch, var(--danger) 10%, transparent);
		border: 1px solid color-mix(in oklch, var(--danger) 25%, transparent);
		border-radius: 8px;
		padding: 10px 16px;
		margin-bottom: 24px;
	}

	/* ── Loading ────────────────────────────────────── */
	.loading-center {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 80px 0;
		color: var(--accent);
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	/* ── Card ───────────────────────────────────────── */
	.card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 24px;
		margin-bottom: 24px;
	}

	.card.no-pad {
		padding: 0;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		color: var(--accent);
	}

	.card-header h2 {
		font-family: var(--font-mono-alt);
		font-size: 15px;
		font-weight: 500;
		color: var(--text);
		margin: 0;
	}

	.card-desc {
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--text-muted);
		margin-bottom: 20px;
		line-height: 1.5;
	}

	.card-desc strong {
		color: var(--text);
	}

	/* ── Form ──────────────────────────────────────── */
	.form-stack {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.form-group label {
		font-family: var(--font-mono-alt);
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}

	.form-group input,
	.add-row input {
		font-family: var(--font-mono-alt);
		font-size: 14px;
		color: var(--text);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 10px 14px;
		transition: border-color 0.15s;
	}

	.form-group input:focus,
	.add-row input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.form-group input::placeholder,
	.add-row input::placeholder {
		color: var(--text-muted);
		opacity: 0.5;
	}

	.hint {
		font-family: var(--font-mono-alt);
		font-size: 12px;
		color: var(--text-muted);
	}

	.hint strong {
		color: var(--text);
	}

	/* ── Buttons ────────────────────────────────────── */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-family: var(--font-mono-alt);
		font-size: 13px;
		font-weight: 500;
		color: var(--bg);
		background: var(--accent);
		border: none;
		border-radius: 8px;
		padding: 10px 20px;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-primary:hover { opacity: 0.85; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-primary.full-width { width: 100%; }

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono-alt);
		font-size: 12px;
		color: var(--text-muted);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 8px 14px;
		cursor: pointer;
		transition: all 0.12s;
		white-space: nowrap;
	}

	.btn-secondary:hover {
		color: var(--text);
		border-color: var(--text-muted);
	}

	.btn-remove {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono-alt);
		font-size: 12px;
		color: var(--text-muted);
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px 10px;
		cursor: pointer;
		transition: all 0.12s;
	}

	.btn-remove:hover {
		color: var(--danger);
		border-color: color-mix(in oklch, var(--danger) 40%, transparent);
	}

	/* ── Team info ──────────────────────────────────── */
	.team-info-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.team-name-row {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--accent);
	}

	.team-name {
		font-family: var(--font-mono-alt);
		font-size: 15px;
		font-weight: 500;
		color: var(--text);
	}

	.status-badge {
		font-family: var(--font-mono-alt);
		font-size: 11px;
		font-weight: 500;
		padding: 2px 8px;
		border-radius: 10px;
		background: color-mix(in oklch, var(--text-muted) 15%, transparent);
		color: var(--text-muted);
	}

	.status-badge.active {
		background: color-mix(in oklch, var(--success) 15%, transparent);
		color: var(--success);
	}

	.status-badge.canceling {
		background: color-mix(in oklch, var(--warning) 15%, transparent);
		color: var(--warning);
	}

	.seats-text {
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--text-muted);
		margin-top: 4px;
	}

	.renewal-text {
		font-family: var(--font-mono-alt);
		font-size: 11px;
		color: var(--text-muted);
		opacity: 0.7;
		margin-top: 2px;
	}

	/* ── Seat bar ───────────────────────────────────── */
	.seats-bar {
		height: 6px;
		width: 100%;
		background: var(--bg-elevated);
		border-radius: 3px;
		overflow: hidden;
	}

	.seats-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 3px;
		transition: width 0.3s;
	}

	/* ── Add member ─────────────────────────────────── */
	.section-title {
		font-family: var(--font-mono-alt);
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		margin: 0 0 12px;
	}

	.count {
		opacity: 0.6;
		margin-left: 4px;
	}

	.add-row {
		display: flex;
		gap: 8px;
	}

	.add-row input {
		flex: 1;
	}

	/* ── Members list ───────────────────────────────── */
	.members-header {
		padding: 16px 24px;
		border-bottom: 1px solid var(--border);
	}

	.members-header .section-title {
		margin: 0;
	}

	.members-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.member-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 24px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.member-row:last-child {
		border-bottom: none;
	}

	.member-name {
		font-family: var(--font-mono-alt);
		font-size: 14px;
		color: var(--text);
		margin: 0;
	}

	.member-email {
		font-family: var(--font-mono-alt);
		font-size: 12px;
		color: var(--text-muted);
		margin: 2px 0 0;
	}

	.you-badge {
		font-family: var(--font-mono-alt);
		font-size: 11px;
		color: var(--text-muted);
		opacity: 0.5;
	}

	.empty-state {
		padding: 40px 24px;
		text-align: center;
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--text-muted);
	}

	/* ── Responsive ─────────────────────────────────── */
	@media (max-width: 640px) {
		.team-content {
			padding: 24px 16px 100px;
		}

		.team-info-row {
			flex-direction: column;
			gap: 12px;
		}

		.add-row {
			flex-direction: column;
		}
	}
</style>
