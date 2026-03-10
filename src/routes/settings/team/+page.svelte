<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Users, Crown, Plus, Trash2, Loader, CreditCard } from '@lucide/svelte';

	let { data } = $props();

	let team = $state<null | {
		id: string;
		name: string;
		status: string;
		seats: number;
		seatsUsed: number;
		renewalDate: string | null;
	}>(null);
	let members = $state<{ id: string; displayName: string; username: string; email: string }[]>([]);
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
				const body: unknown = await res.json();
				const b = body as { team?: typeof team; members?: typeof members };
				team = b.team ?? null;
				members = b.members ?? [];
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
				const body: unknown = await res.json();
				const b = body as { url?: string };
				if (b.url) {
					window.location.href = b.url;
				}
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

	async function openPortal() {
		error = '';
		try {
			const res = await fetch('/api/billing/portal', { method: 'POST' });
			if (res.ok) {
				const body: unknown = await res.json();
				const b = body as { url?: string };
				if (b.url) {
					window.location.href = b.url;
				}
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

	const hasAvailableSeats = $derived(
		team !== null && team.status === 'active' && team.seatsUsed < team.seats
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

<div class="min-h-screen bg-zinc-900 text-zinc-100">
	<div class="mx-auto max-w-2xl px-4 py-10">
		<!-- Back link -->
		<button
			class="mb-8 flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
			onclick={() => goto('/settings')}
			data-testid="back-to-settings"
		>
			<ArrowLeft class="h-4 w-4" />
			Back to Settings
		</button>

		<!-- Header -->
		<div class="mb-8 flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
				<Users class="h-5 w-5 text-amber-400" />
			</div>
			<div>
				<h1 class="text-xl font-semibold text-zinc-100">Team</h1>
				<p class="text-sm text-zinc-400">Manage your team subscription and members</p>
			</div>
		</div>

		<!-- Error -->
		{#if error}
			<div
				class="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
				data-testid="team-error"
			>
				{error}
			</div>
		{/if}

		<!-- Loading -->
		{#if loading}
			<div class="flex items-center justify-center py-20">
				<Loader class="h-6 w-6 animate-spin text-amber-400" />
			</div>

		<!-- No team: create form -->
		{:else if !team}
			<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
				<div class="mb-6 flex items-center gap-2">
					<Crown class="h-5 w-5 text-amber-400" />
					<h2 class="text-base font-medium text-zinc-100">Create a Team</h2>
				</div>
				<p class="mb-6 text-sm text-zinc-400">
					A team subscription lets you assign Pro status to multiple users under one invoice.
					Each seat costs <span class="text-zinc-200">$10/user/month</span>.
				</p>

				<div class="space-y-4">
					<div>
						<label for="team-name" class="mb-1.5 block text-sm text-zinc-300">Team name</label>
						<input
							id="team-name"
							type="text"
							placeholder="Acme Corp"
							bind:value={teamName}
							class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20"
							data-testid="team-name-input"
						/>
					</div>

					<div>
						<label for="team-seats" class="mb-1.5 block text-sm text-zinc-300">
							Number of seats
						</label>
						<input
							id="team-seats"
							type="number"
							min="1"
							max="500"
							bind:value={teamSeats}
							class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20"
							data-testid="team-seats-input"
						/>
						<p class="mt-1 text-xs text-zinc-500">
							Total: <span class="text-zinc-300">${teamSeats * 10}/month</span>
						</p>
					</div>

					<button
						class="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
						onclick={createTeam}
						disabled={createLoading || !teamName.trim()}
						data-testid="create-team-button"
					>
						{#if createLoading}
							<Loader class="h-4 w-4 animate-spin" />
							Redirecting to checkout…
						{:else}
							<CreditCard class="h-4 w-4" />
							Continue to Checkout
						{/if}
					</button>
				</div>
			</div>

		<!-- Team exists -->
		{:else}
			<!-- Team info card -->
			<div class="mb-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
				<div class="mb-4 flex items-start justify-between">
					<div>
						<div class="flex items-center gap-2">
							<Crown class="h-4 w-4 text-amber-400" />
							<span class="text-base font-medium text-zinc-100">{team.name}</span>
							<span
								class={[
									'rounded-full px-2 py-0.5 text-xs font-medium',
									team.status === 'active'
										? 'bg-emerald-500/15 text-emerald-400'
										: 'bg-zinc-700 text-zinc-400'
								].join(' ')}
								data-testid="team-status"
							>
								{team.status}
							</span>
						</div>
						<p class="mt-1 text-sm text-zinc-400">
							{team.seatsUsed} / {team.seats} seats used
						</p>
						{#if team.renewalDate}
							<p class="mt-0.5 text-xs text-zinc-500">
								Renews {formatDate(team.renewalDate)}
							</p>
						{/if}
					</div>

					<button
						class="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
						onclick={openPortal}
						data-testid="manage-billing-button"
					>
						<CreditCard class="h-3.5 w-3.5" />
						Manage Billing
					</button>
				</div>

				<!-- Seat usage bar -->
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
					<div
						class="h-full rounded-full bg-amber-500 transition-all"
						style="width: {Math.min(100, (team.seatsUsed / team.seats) * 100)}%"
					></div>
				</div>
			</div>

			<!-- Add member form (only if active + seats available) -->
			{#if hasAvailableSeats}
				<div class="mb-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
					<h2 class="mb-4 text-sm font-medium text-zinc-300">Add Member</h2>
					<div class="flex gap-2">
						<input
							type="email"
							placeholder="member@example.com"
							bind:value={addEmail}
							class="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20"
							data-testid="add-member-email-input"
						/>
						<button
							class="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
							onclick={addMember}
							disabled={addLoading || !addEmail.trim()}
							data-testid="add-member-button"
						>
							{#if addLoading}
								<Loader class="h-4 w-4 animate-spin" />
							{:else}
								<Plus class="h-4 w-4" />
							{/if}
							Add
						</button>
					</div>
				</div>
			{/if}

			<!-- Members list -->
			<div class="rounded-xl border border-zinc-800 bg-zinc-900">
				<div class="border-b border-zinc-800 px-6 py-4">
					<h2 class="text-sm font-medium text-zinc-300">
						Members
						<span class="ml-1.5 text-zinc-500">({members.length})</span>
					</h2>
				</div>

				{#if members.length === 0}
					<div class="px-6 py-10 text-center text-sm text-zinc-500">
						No members yet. Add someone above.
					</div>
				{:else}
					<ul class="divide-y divide-zinc-800">
						{#each members as member (member.id)}
							<li class="flex items-center justify-between px-6 py-4" data-testid="member-row">
								<div>
									<p class="text-sm text-zinc-100">
										{member.displayName || member.username}
									</p>
									<p class="text-xs text-zinc-500">{member.email}</p>
								</div>
								{#if member.id !== data.userId}
									<button
										class="flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-red-500/40 hover:text-red-400"
										onclick={() => removeMember(member.id)}
										data-testid="remove-member-button"
									>
										<Trash2 class="h-3.5 w-3.5" />
										Remove
									</button>
								{:else}
									<span class="text-xs text-zinc-600">You</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
</div>
