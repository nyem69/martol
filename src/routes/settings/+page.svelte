<script lang="ts">
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, User, Shield, AlertTriangle, Loader, Check, Monitor, Download, Trash2, X } from '@lucide/svelte';
	import { signOut } from '$lib/auth-client';

	let { data } = $props();

	// These values are stable for the page lifetime (server load runs once).
	// svelte-ignore state_referenced_locally — intentional: capturing initial snapshot.
	const profile = data.profile;

	// Username change state
	let newUsername = $state('');
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let currentUsername = $state(profile.username);

	// Cooldown calculation
	const COOLDOWN_DAYS = 90;
	// svelte-ignore state_referenced_locally
	const lastChangeDate = data.lastUsernameChange ? new Date(data.lastUsernameChange) : null;
	const cooldownEnd = lastChangeDate
		? new Date(lastChangeDate.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
		: null;
	const isOnCooldown = $derived(cooldownEnd ? new Date() < cooldownEnd : false);
	const cooldownDaysLeft = $derived(
		cooldownEnd ? Math.max(0, Math.ceil((cooldownEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 0
	);

	// Username validation
	const usernameValid = $derived(
		newUsername.length >= 3 &&
		newUsername.length <= 32 &&
		/^[a-zA-Z0-9_]+$/.test(newUsername) &&
		newUsername.toLowerCase() !== currentUsername.toLowerCase()
	);

	const canSave = $derived(usernameValid && !saving && !isOnCooldown);

	async function handleSaveUsername() {
		if (!canSave) return;
		saving = true;
		errorMsg = '';
		successMsg = '';

		try {
			const res = await fetch('/api/account/username', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: newUsername })
			});

			const result: { ok: boolean; username?: string; error?: string } = await res.json();

			if (!res.ok || !result.ok) {
				errorMsg = result.error || m.error_generic();
				return;
			}

			currentUsername = result.username ?? newUsername;
			newUsername = '';
			successMsg = m.settings_username_changed();
			setTimeout(() => (successMsg = ''), 4000);
		} catch {
			errorMsg = m.error_generic();
		} finally {
			saving = false;
		}
	}

	// ── Sessions state ──
	interface SessionEntry {
		id: string;
		current: boolean;
		createdAt: string;
		expiresAt: string;
		ipAddress: string | null;
		userAgent: string | null;
	}
	let sessions = $state<SessionEntry[]>([]);
	let sessionsLoading = $state(true);
	let revokingId = $state<string | null>(null);

	async function loadSessions() {
		sessionsLoading = true;
		try {
			const res = await fetch('/api/account/sessions');
			const result: { ok: boolean; data: SessionEntry[] } = await res.json();
			if (result.ok) sessions = result.data;
		} catch { /* ignore */ }
		sessionsLoading = false;
	}

	$effect(() => { loadSessions(); });

	async function revokeSession(sessionId: string) {
		revokingId = sessionId;
		try {
			const res = await fetch('/api/account/sessions', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId })
			});
			if (res.ok) {
				sessions = sessions.filter((s) => s.id !== sessionId);
			} else {
				const result: { error?: string } = await res.json();
				errorMsg = result.error || m.error_generic();
			}
		} catch {
			errorMsg = m.error_generic();
		}
		revokingId = null;
	}

	function parseUA(ua: string | null): string {
		if (!ua) return 'Unknown device';
		if (ua.includes('Mobile')) return 'Mobile browser';
		if (ua.includes('Chrome')) return 'Chrome';
		if (ua.includes('Firefox')) return 'Firefox';
		if (ua.includes('Safari')) return 'Safari';
		return 'Browser';
	}

	// ── Data export state ──
	let exporting = $state(false);

	async function handleExport() {
		exporting = true;
		try {
			const res = await fetch('/api/account/export');
			if (!res.ok) throw new Error();
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			try {
				const a = document.createElement('a');
				a.href = url;
				a.download = `martol-data-export-${new Date().toISOString().slice(0, 10)}.json`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
			} finally {
				URL.revokeObjectURL(url);
			}
		} catch {
			errorMsg = m.error_generic();
		}
		exporting = false;
	}

	// ── Account deletion state ──
	let showDeleteConfirm = $state(false);
	let deleteInput = $state('');
	let deleting = $state(false);
	const canDelete = $derived(deleteInput === 'DELETE MY ACCOUNT' && !deleting);

	async function handleDelete() {
		if (!canDelete) return;
		deleting = true;
		try {
			const res = await fetch('/api/account/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ confirm: 'DELETE MY ACCOUNT' })
			});
			if (res.ok) {
				await signOut();
				goto('/login');
			} else {
				const result: { error?: string } = await res.json();
				errorMsg = result.error || m.error_generic();
			}
		} catch {
			errorMsg = m.error_generic();
		}
		deleting = false;
	}

	// Format member since date
	const memberSince = new Date(profile.createdAt).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
</script>

<svelte:head>
	<title>{m.settings_title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex min-h-dvh justify-center px-4 py-8" style="background: var(--bg);">
	<div class="w-full max-w-lg">
		<!-- Back to chat -->
		<button
			onclick={() => goto('/chat')}
			class="mb-6 inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-80"
			style="color: var(--text-muted);"
			data-testid="back-to-chat"
		>
			<ArrowLeft size={16} />
			{m.settings_back()}
		</button>

		<!-- Page title -->
		<h1
			class="mb-8 text-xl font-bold tracking-widest"
			style="color: var(--accent); font-family: var(--font-mono);"
		>
			{m.settings_title()}
		</h1>

		<!-- ═══ USERNAME SECTION ═══ -->
		<section
			class="mb-6 rounded-lg p-5"
			style="background: var(--bg-surface); border: 1px solid var(--border);"
		>
			<div class="mb-4 flex items-center gap-2">
				<User size={16} style="color: var(--accent);" />
				<h2
					class="text-sm font-bold uppercase tracking-wider"
					style="color: var(--text); font-family: var(--font-mono);"
				>
					{m.settings_username()}
				</h2>
			</div>

			<!-- Current username -->
			<div class="mb-4">
				<span
					class="mb-1 block text-xs"
					style="color: var(--text-muted);"
				>
					{m.settings_username_current()}
				</span>
				<div
					class="rounded-md px-3 py-2 text-sm"
					style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
				>
					{currentUsername || '—'}
				</div>
			</div>

			<!-- Cooldown warning -->
			{#if isOnCooldown}
				<div
					class="mb-4 rounded-md px-3 py-2 text-xs"
					style="background: color-mix(in oklch, var(--accent) 10%, transparent); border: 1px solid color-mix(in oklch, var(--accent) 25%, transparent); color: var(--accent);"
				>
					{m.settings_username_cooldown()} — {cooldownDaysLeft} day{cooldownDaysLeft === 1 ? '' : 's'} remaining
				</div>
			{/if}

			<!-- New username input -->
			<div class="mb-3">
				<label
					for="new-username"
					class="mb-1 block text-xs"
					style="color: var(--text-muted);"
				>
					{m.settings_username_new()}
				</label>
				<input
					id="new-username"
					type="text"
					bind:value={newUsername}
					placeholder="my_username"
					maxlength="32"
					disabled={isOnCooldown || saving}
					data-testid="new-username-input"
					class="w-full rounded-md px-3 py-2.5 text-sm outline-none"
					style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
				/>
				<p class="mt-1 text-[11px]" style="color: var(--text-muted);">
					{m.settings_username_rules()}
				</p>
			</div>

			<!-- Error / success -->
			{#if errorMsg}
				<div
					class="mb-3 rounded-md px-3 py-2 text-xs"
					style="background: color-mix(in oklch, var(--danger) 10%, transparent); color: var(--danger);"
					role="alert"
				>
					{errorMsg}
				</div>
			{/if}

			{#if successMsg}
				<div
					class="mb-3 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs"
					style="background: color-mix(in oklch, var(--success) 10%, transparent); color: var(--success);"
					role="status"
				>
					<Check size={14} />
					{successMsg}
				</div>
			{/if}

			<!-- Save button -->
			<button
				onclick={handleSaveUsername}
				disabled={!canSave}
				data-testid="save-username-btn"
				class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
				style="background: var(--accent); color: var(--bg); letter-spacing: 0.5px; font-family: var(--font-mono);"
			>
				{#if saving}
					<Loader size={14} class="animate-spin" />
					{m.settings_username_saving()}
				{:else}
					{m.settings_username_save()}
				{/if}
			</button>
		</section>

		<!-- ═══ ACCOUNT INFO SECTION ═══ -->
		<section
			class="mb-6 rounded-lg p-5"
			style="background: var(--bg-surface); border: 1px solid var(--border);"
		>
			<div class="mb-4 flex items-center gap-2">
				<Shield size={16} style="color: var(--accent);" />
				<h2
					class="text-sm font-bold uppercase tracking-wider"
					style="color: var(--text); font-family: var(--font-mono);"
				>
					{m.settings_account()}
				</h2>
			</div>

			<!-- Email (read-only, masked) -->
			<div class="mb-3">
				<span
					class="mb-1 block text-xs"
					style="color: var(--text-muted);"
				>
					{m.settings_email()}
				</span>
				<div
					class="rounded-md px-3 py-2 text-sm"
					style="background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); font-family: var(--font-mono);"
				>
					{profile.email}
				</div>
			</div>

			<!-- Member since -->
			<div>
				<span
					class="mb-1 block text-xs"
					style="color: var(--text-muted);"
				>
					{m.settings_member_since()}
				</span>
				<div
					class="rounded-md px-3 py-2 text-sm"
					style="background: var(--bg); border: 1px solid var(--border); color: var(--text-muted);"
				>
					{memberSince}
				</div>
			</div>
		</section>

		<!-- ═══ SESSIONS SECTION ═══ -->
		<section
			class="mb-6 rounded-lg p-5"
			style="background: var(--bg-surface); border: 1px solid var(--border);"
		>
			<div class="mb-4 flex items-center gap-2">
				<Monitor size={16} style="color: var(--accent);" />
				<h2
					class="text-sm font-bold uppercase tracking-wider"
					style="color: var(--text); font-family: var(--font-mono);"
				>
					{m.settings_sessions()}
				</h2>
			</div>

			{#if sessionsLoading}
				<div class="flex items-center gap-2 text-xs" style="color: var(--text-muted);">
					<Loader size={14} class="animate-spin" />
					{m.settings_sessions_loading()}
				</div>
			{:else if sessions.length === 0}
				<p class="text-xs" style="color: var(--text-muted);">
					{m.settings_sessions_none()}
				</p>
			{:else}
				<div class="space-y-2">
					{#each sessions as sess (sess.id)}
						<div
							class="flex items-center justify-between rounded-md px-3 py-2"
							style="background: var(--bg); border: 1px solid var(--border);"
						>
							<div>
								<div class="flex items-center gap-2 text-sm" style="color: var(--text); font-family: var(--font-mono);">
									{parseUA(sess.userAgent)}
									{#if sess.current}
										<span
											class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
											style="background: color-mix(in oklch, var(--accent) 15%, transparent); color: var(--accent);"
										>
											{m.settings_sessions_current()}
										</span>
									{/if}
								</div>
								<div class="mt-0.5 text-[11px]" style="color: var(--text-muted);">
									{sess.ipAddress ?? '—'} · {new Date(sess.createdAt).toLocaleDateString()}
								</div>
							</div>
							{#if !sess.current}
								<button
									onclick={() => revokeSession(sess.id)}
									disabled={revokingId === sess.id}
									data-testid="revoke-session-{sess.id}"
									class="rounded px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
									style="background: color-mix(in oklch, var(--danger) 12%, transparent); color: var(--danger); font-family: var(--font-mono);"
									title={m.settings_sessions_revoke_confirm()}
								>
									{#if revokingId === sess.id}
										<Loader size={12} class="animate-spin" />
									{:else}
										{m.settings_sessions_revoke()}
									{/if}
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- ═══ DATA EXPORT SECTION ═══ -->
		<section
			class="mb-6 rounded-lg p-5"
			style="background: var(--bg-surface); border: 1px solid var(--border);"
		>
			<div class="mb-4 flex items-center gap-2">
				<Download size={16} style="color: var(--accent);" />
				<h2
					class="text-sm font-bold uppercase tracking-wider"
					style="color: var(--text); font-family: var(--font-mono);"
				>
					{m.settings_export()}
				</h2>
			</div>

			<p class="mb-3 text-xs" style="color: var(--text-muted);">
				{m.settings_export_desc()}
			</p>

			<button
				onclick={handleExport}
				disabled={exporting}
				data-testid="export-data-btn"
				class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
				style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
			>
				{#if exporting}
					<Loader size={14} class="animate-spin" />
					{m.settings_export_downloading()}
				{:else}
					<Download size={14} />
					{m.settings_export_btn()}
				{/if}
			</button>
		</section>

		<!-- ═══ DANGER ZONE ═══ -->
		<section
			class="rounded-lg p-5"
			style="background: var(--bg-surface); border: 1px solid color-mix(in oklch, var(--danger) 30%, var(--border));"
		>
			<div class="mb-4 flex items-center gap-2">
				<AlertTriangle size={16} style="color: var(--danger);" />
				<h2
					class="text-sm font-bold uppercase tracking-wider"
					style="color: var(--danger); font-family: var(--font-mono);"
				>
					{m.settings_danger_zone()}
				</h2>
			</div>

			{#if !showDeleteConfirm}
				<button
					onclick={() => (showDeleteConfirm = true)}
					data-testid="delete-account-btn"
					class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
					style="background: color-mix(in oklch, var(--danger) 15%, transparent); color: var(--danger); font-family: var(--font-mono);"
				>
					<Trash2 size={14} />
					{m.settings_delete_account()}
				</button>
			{:else}
				<div class="space-y-3">
					<p class="text-xs" style="color: var(--danger);">
						{m.settings_delete_confirm()}
					</p>
					<input
						type="text"
						bind:value={deleteInput}
						placeholder="DELETE MY ACCOUNT"
						data-testid="delete-confirm-input"
						class="w-full rounded-md px-3 py-2.5 text-sm outline-none"
						style="background: var(--bg); border: 1px solid color-mix(in oklch, var(--danger) 40%, var(--border)); color: var(--text); font-family: var(--font-mono);"
					/>
					<div class="flex gap-2">
						<button
							onclick={handleDelete}
							disabled={!canDelete}
							data-testid="confirm-delete-btn"
							class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
							style="background: var(--danger); color: var(--bg); font-family: var(--font-mono);"
						>
							{#if deleting}
								<Loader size={14} class="animate-spin" />
								{m.settings_delete_confirming()}
							{:else}
								<Trash2 size={14} />
								{m.settings_delete_account()}
							{/if}
						</button>
						<button
							onclick={() => { showDeleteConfirm = false; deleteInput = ''; }}
							aria-label="Cancel account deletion"
							data-testid="cancel-delete-btn"
							class="rounded-md px-3 py-2.5 text-sm transition-opacity hover:opacity-80"
							style="color: var(--text-muted);"
						>
							<X size={14} />
						</button>
					</div>
				</div>
			{/if}
		</section>
	</div>
</div>
