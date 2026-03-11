<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, User, Shield, AlertTriangle, Loader, Check, Monitor, Download, Trash2, X, CreditCard, Crown, Upload, Users, Bot, MessageSquare, Fingerprint, BookOpen, LifeBuoy, LayoutGrid, FileText, Mail, Image, Paperclip, ChevronLeft } from '@lucide/svelte';
	import { signOut, passkey } from '$lib/auth-client';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

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
			await invalidateAll();
			setTimeout(() => (successMsg = ''), 4000);
		} catch {
			errorMsg = m.error_generic();
		} finally {
			saving = false;
		}
	}

	// ── Email change state ──
	let showEmailChange = $state(false);
	let newEmail = $state('');
	let emailChanging = $state(false);
	let emailMsg = $state('');
	let emailError = $state('');

	// Email change cooldown (30 days)
	const EMAIL_COOLDOWN_DAYS = 30;
	// svelte-ignore state_referenced_locally
	const lastEmailChangeDate = data.lastEmailChange ? new Date(data.lastEmailChange) : null;
	const emailCooldownEnd = lastEmailChangeDate
		? new Date(lastEmailChangeDate.getTime() + EMAIL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
		: null;
	const isEmailOnCooldown = $derived(emailCooldownEnd ? new Date() < emailCooldownEnd : false);
	const emailCooldownDaysLeft = $derived(
		emailCooldownEnd ? Math.max(0, Math.ceil((emailCooldownEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 0
	);

	// Check URL params for email change redirect result
	$effect(() => {
		const params = new URLSearchParams(window.location.search);
		const emailChange = params.get('email_change');
		if (emailChange === 'confirmed') {
			emailMsg = m.settings_email_change_confirmed();
			setTimeout(() => (emailMsg = ''), 5000);
		} else if (emailChange === 'reverted') {
			emailMsg = m.settings_email_change_reverted();
			setTimeout(() => (emailMsg = ''), 5000);
		} else if (emailChange === 'expired') {
			emailError = 'Link expired. Please request a new email change.';
			setTimeout(() => (emailError = ''), 5000);
		}
		if (emailChange) {
			const url = new URL(window.location.href);
			url.searchParams.delete('email_change');
			window.history.replaceState({}, '', url.toString());
		}
	});

	async function handleEmailChange() {
		if (!newEmail.trim() || emailChanging) return;
		emailChanging = true;
		emailMsg = '';
		emailError = '';

		try {
			const res = await fetch('/api/account/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: newEmail.trim() })
			});

			const result: { ok?: boolean; error?: string } = await res.json();

			if (!res.ok || !result.ok) {
				emailError = result.error || m.settings_email_change_error();
				return;
			}

			emailMsg = m.settings_email_change_sent();
			newEmail = '';
			showEmailChange = false;
			setTimeout(() => (emailMsg = ''), 8000);
		} catch {
			emailError = m.settings_email_change_error();
		} finally {
			emailChanging = false;
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
	let exportingAudit = $state(false);
	let showExportModal = $state(false);
	let exportStep = $state<'rooms' | 'preview' | 'generating' | 'done'>('rooms');
	let exportRooms = $state<{ id: string; name: string }[]>([]);
	let exportSelectedRoom = $state<{ id: string; name: string } | null>(null);
	let exportPreview = $state<{
		roomName: string;
		messageCount: number;
		dateRange: { from: string | null; to: string | null };
		photos: { count: number; bytes: number };
		files: { count: number; bytes: number };
	} | null>(null);
	let exportIncludePhotos = $state(false);
	let exportIncludeFiles = $state(false);
	let exportLoading = $state(false);
	let exportError = $state('');
	let exportDoneMsg = $state('');

	async function openExportModal() {
		showExportModal = true;
		exportStep = 'rooms';
		exportError = '';
		exportLoading = true;
		try {
			const res = await fetch('/api/account/export/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			const result: any = await res.json();
			if (res.ok && result.ok) {
				exportRooms = result.rooms;
			} else {
				exportError = result.error?.message || m.error_generic();
			}
		} catch {
			exportError = m.error_generic();
		}
		exportLoading = false;
	}

	async function selectExportRoom(room: { id: string; name: string }) {
		exportSelectedRoom = room;
		exportStep = 'preview';
		exportError = '';
		exportLoading = true;
		exportIncludePhotos = false;
		exportIncludeFiles = false;
		try {
			const res = await fetch('/api/account/export/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roomId: room.id })
			});
			const result: any = await res.json();
			if (res.ok && result.ok) {
				exportPreview = result.preview;
			} else {
				exportError = result.error?.message || m.error_generic();
			}
		} catch {
			exportError = m.error_generic();
		}
		exportLoading = false;
	}

	async function confirmExport() {
		if (!exportSelectedRoom) return;
		exportStep = 'generating';
		exportError = '';
		try {
			const res = await fetch('/api/account/export/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					roomId: exportSelectedRoom.id,
					includePhotos: exportIncludePhotos,
					includeFiles: exportIncludeFiles,
					confirm: true
				})
			});
			const result: any = await res.json();
			if (res.ok && result.ok) {
				exportStep = 'done';
				exportDoneMsg = result.message;
			} else {
				exportStep = 'preview';
				exportError = result.error?.message || m.error_generic();
			}
		} catch {
			exportStep = 'preview';
			exportError = m.error_generic();
		}
	}

	function closeExportModal() {
		showExportModal = false;
		exportSelectedRoom = null;
		exportPreview = null;
		exportError = '';
		exportDoneMsg = '';
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function handleAuditExport() {
		exportingAudit = true;
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
		exportingAudit = false;
	}

	// ── Billing state ──
	/** Format plan limit: -1 → ∞, otherwise the number */
	function fmtLimit(n: number): string { return n === -1 ? '∞' : String(n); }

	// Reactive — updates when invalidateAll() re-runs the server loader
	let billing = $derived(data.billing);
	let roomCount = $derived(data.roomCount);
	let isOwnerOrLead = $derived(data.isOwnerOrLead);
	let team = $derived(data.team);
	let hasTeamPro = $derived(data.hasTeamPro);
	let upgrading = $state(false);
	let managing = $state(false);
	let billingError = $state('');
	let billingSuccess = $state('');
	let billingVerifying = $state(false);
	let upgradeInterval = $state<'month' | 'year'>('month');

	// Check URL params for billing/team redirect result
	async function verifyCheckoutReturn() {
		const params = new URLSearchParams(window.location.search);
		const billingParam = params.get('billing');
		const teamParam = params.get('team');
		const sessionId = params.get('session_id');

		if (billingParam !== 'success' && teamParam !== 'success') return;

		// Clean URL immediately
		const url = new URL(window.location.href);
		url.searchParams.delete('billing');
		url.searchParams.delete('team');
		url.searchParams.delete('session_id');
		window.history.replaceState({}, '', url.toString());

		billingVerifying = true;

		// Verify checkout with Stripe and activate subscription in DB
		// (webhook may be delayed — this ensures immediate activation)
		try {
			if (sessionId) {
				await fetch('/api/billing/verify', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ session_id: sessionId })
				});
			}
		} catch {
			// verify failed — sync on page load will catch it
		}

		await invalidateAll();
		billingVerifying = false;

		billingSuccess = m.billing_success();
		setTimeout(() => (billingSuccess = ''), 5000);
	}

	$effect(() => {
		verifyCheckoutReturn();
	});

	async function handleUpgrade() {
		upgrading = true;
		billingError = '';
		try {
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ interval: upgradeInterval })
			});
			const result: { url?: string; error?: { message?: string } } = await res.json();
			if (res.ok && result.url) {
				window.location.href = result.url;
				return; // Don't reset upgrading — page is navigating away
			}
			billingError = m.billing_error();
		} catch {
			billingError = m.billing_error();
		}
		upgrading = false;
	}

	async function handleManageBilling() {
		managing = true;
		billingError = '';
		try {
			const res = await fetch('/api/billing/portal', { method: 'POST' });
			const result: { url?: string; error?: { message?: string } } = await res.json();
			if (res.ok && result.url) {
				window.location.href = result.url;
				return;
			}
			billingError = m.billing_error();
		} catch {
			billingError = m.billing_error();
		}
		managing = false;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
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
				goto('/');
			} else {
				const result: { error?: string } = await res.json();
				errorMsg = result.error || m.error_generic();
			}
		} catch {
			errorMsg = m.error_generic();
		}
		deleting = false;
	}

	// ── Passkeys state ──
	interface PasskeyEntry {
		id: string;
		name: string | null;
		createdAt: string | null;
	}
	let passkeys = $state<PasskeyEntry[]>([]);
	let passkeysLoading = $state(true);
	let passkeyName = $state('');
	let registering = $state(false);
	let passkeyMsg = $state('');
	let passkeyError = $state('');
	let deletingPasskeyId = $state<string | null>(null);

	async function loadPasskeys() {
		passkeysLoading = true;
		try {
			const res = await fetch('/api/auth/passkey/list-user-passkeys');
			if (res.ok) {
				const data: any[] = await res.json();
				passkeys = data.map((pk: any) => ({
					id: pk.id,
					name: pk.name,
					createdAt: pk.createdAt ? new Date(pk.createdAt).toLocaleDateString() : null
				}));
			}
		} catch { /* ignore */ }
		passkeysLoading = false;
	}

	$effect(() => { loadPasskeys(); });

	async function handleRegisterPasskey() {
		if (registering) return;
		registering = true;
		passkeyMsg = '';
		passkeyError = '';
		try {
			const res = await passkey.addPasskey({ name: passkeyName.trim() || undefined });
			if (res.error) {
				passkeyError = res.error.message || m.error_generic();
			} else {
				passkeyName = '';
				passkeyMsg = m.passkey_added();
				setTimeout(() => (passkeyMsg = ''), 4000);
				await loadPasskeys();
			}
		} catch {
			passkeyError = m.error_generic();
		}
		registering = false;
	}

	async function handleDeletePasskey(id: string) {
		deletingPasskeyId = id;
		passkeyMsg = '';
		passkeyError = '';
		try {
			const res = await fetch('/api/auth/passkey/delete-passkey', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!res.ok) {
				const data: any = await res.json().catch(() => ({}));
				passkeyError = data?.message || m.error_generic();
			} else {
				passkeys = passkeys.filter((pk) => pk.id !== id);
				passkeyMsg = m.passkey_removed();
				setTimeout(() => (passkeyMsg = ''), 4000);
			}
		} catch {
			passkeyError = m.error_generic();
		}
		deletingPasskeyId = null;
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
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex min-h-dvh justify-center px-4 py-8 pb-16 overflow-y-auto h-dvh" style="background: var(--bg);">
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
		<div class="mb-8 flex items-center justify-between">
			<h1
				class="text-xl font-bold tracking-widest"
				style="color: var(--accent); font-family: var(--font-mono);"
			>
				{m.settings_title()}
			</h1>
			<ThemeToggle />
		</div>

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
					style="background: var(--bg); border: 1px solid var(--border); color: {isOnCooldown ? 'var(--text-muted)' : 'var(--text)'}; font-family: var(--font-mono); opacity: {isOnCooldown ? '0.6' : '1'};"
				>
					{currentUsername || '—'}
				</div>
			</div>

			<!-- Cooldown warning -->
			{#if isOnCooldown}
				<div
					class="rounded-md px-3 py-2 text-xs"
					style="background: color-mix(in oklch, var(--accent) 10%, transparent); border: 1px solid color-mix(in oklch, var(--accent) 25%, transparent); color: var(--accent);"
				>
					{m.settings_username_cooldown()} — {cooldownDaysLeft} day{cooldownDaysLeft === 1 ? '' : 's'} remaining
				</div>
			{:else}
				<!-- New username input (hidden during cooldown) -->
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
						disabled={saving}
						data-testid="new-username-input"
						class="w-full rounded-md px-3 py-2.5 text-sm"
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
			{/if}
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

			<!-- Email with change option -->
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

				{#if emailMsg}
					<div
						class="mt-2 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs"
						style="background: color-mix(in oklch, var(--success) 10%, transparent); color: var(--success);"
						role="status"
					>
						<Check size={14} />
						{emailMsg}
					</div>
				{/if}

				{#if emailError}
					<div
						class="mt-2 rounded-md px-3 py-2 text-xs"
						style="background: color-mix(in oklch, var(--danger) 10%, transparent); color: var(--danger);"
						role="alert"
					>
						{emailError}
					</div>
				{/if}

				{#if isEmailOnCooldown}
					<p class="mt-2 text-xs" style="color: var(--text-muted); opacity: 0.6;">
						Email change available in {emailCooldownDaysLeft} day{emailCooldownDaysLeft === 1 ? '' : 's'}
					</p>
				{:else if !showEmailChange}
					<button
						onclick={() => (showEmailChange = true)}
						data-testid="toggle-email-change"
						class="mt-2 text-xs transition-opacity hover:opacity-80"
						style="color: var(--text-muted);"
					>
						Change email address
					</button>
				{:else}
					<div class="mt-3 space-y-2">
						<label
							for="new-email"
							class="block text-xs"
							style="color: var(--text-muted);"
						>
							{m.settings_email_new()}
						</label>
						<input
							id="new-email"
							type="email"
							bind:value={newEmail}
							placeholder="new@example.com"
							disabled={emailChanging}
							data-testid="new-email-input"
							class="w-full rounded-md px-3 py-2.5 text-sm"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						/>
						<p class="text-[11px]" style="color: var(--text-muted);">
							A confirmation link will be sent to your current email first, then to the new address.
						</p>
						<div class="flex items-center gap-2">
							<button
								onclick={handleEmailChange}
								disabled={!newEmail.trim() || emailChanging}
								data-testid="submit-email-change"
								class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
								style="background: var(--accent); color: var(--bg); letter-spacing: 0.5px; font-family: var(--font-mono);"
							>
								{#if emailChanging}
									<Loader size={14} class="animate-spin" />
								{/if}
								{m.settings_email_change_submit()}
							</button>
							<button
								onclick={() => { showEmailChange = false; newEmail = ''; }}
								class="text-xs transition-opacity hover:opacity-80"
								style="color: var(--text-muted);"
							>
								Cancel
							</button>
						</div>
					</div>
				{/if}
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

		<!-- ═══ PASSKEYS SECTION ═══ -->
		<section
			class="mb-6 rounded-lg p-5"
			style="background: var(--bg-surface); border: 1px solid var(--border);"
		>
			<div class="mb-4 flex items-center gap-2">
				<Fingerprint size={16} style="color: var(--accent);" />
				<h2
					class="text-sm font-bold uppercase tracking-wider"
					style="color: var(--text); font-family: var(--font-mono);"
				>
					{m.passkey_title()}
				</h2>
			</div>

			{#if passkeysLoading}
				<div class="flex items-center gap-2 text-xs" style="color: var(--text-muted);">
					<Loader size={14} class="animate-spin" />
					{m.settings_sessions_loading()}
				</div>
			{:else if passkeys.length === 0}
				<p class="mb-3 text-xs" style="color: var(--text-muted);">
					{m.passkey_empty()}
				</p>
			{:else}
				<div class="mb-3 space-y-2">
					{#each passkeys as pk (pk.id)}
						<div
							class="flex items-center justify-between rounded-md px-3 py-2"
							style="background: var(--bg); border: 1px solid var(--border);"
						>
							<div>
								<div class="text-sm" style="color: var(--text); font-family: var(--font-mono);">
									{pk.name || 'Passkey'}
								</div>
								{#if pk.createdAt}
									<div class="mt-0.5 text-[11px]" style="color: var(--text-muted);">
										{pk.createdAt}
									</div>
								{/if}
							</div>
							<button
								onclick={() => handleDeletePasskey(pk.id)}
								disabled={deletingPasskeyId === pk.id}
								data-testid="delete-passkey-{pk.id}"
								class="rounded px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
								style="background: color-mix(in oklch, var(--danger) 12%, transparent); color: var(--danger); font-family: var(--font-mono);"
								title={m.passkey_delete()}
							>
								{#if deletingPasskeyId === pk.id}
									<Loader size={12} class="animate-spin" />
								{:else}
									{m.passkey_delete()}
								{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}

			{#if passkeyError}
				<div
					class="mb-3 rounded-md px-3 py-2 text-xs"
					style="background: color-mix(in oklch, var(--danger) 10%, transparent); color: var(--danger);"
					role="alert"
				>
					{passkeyError}
				</div>
			{/if}

			{#if passkeyMsg}
				<div
					class="mb-3 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs"
					style="background: color-mix(in oklch, var(--success) 10%, transparent); color: var(--success);"
					role="status"
				>
					<Check size={14} />
					{passkeyMsg}
				</div>
			{/if}

			<!-- Register new passkey -->
			<div class="flex items-center gap-2">
				<input
					type="text"
					bind:value={passkeyName}
					placeholder={m.passkey_name_placeholder()}
					aria-label={m.passkey_name_placeholder()}
					disabled={registering}
					data-testid="passkey-name-input"
					class="flex-1 rounded-md px-3 py-2.5 text-sm"
					style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
				/>
				<button
					onclick={handleRegisterPasskey}
					disabled={registering}
					data-testid="register-passkey-btn"
					class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
					style="background: var(--accent); color: var(--bg); letter-spacing: 0.5px; font-family: var(--font-mono);"
				>
					{#if registering}
						<Loader size={14} class="animate-spin" />
						{m.passkey_registering()}
					{:else}
						<Fingerprint size={14} />
						{m.passkey_register()}
					{/if}
				</button>
			</div>
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
				{m.export_desc()}
			</p>

			<div class="flex gap-3">
				<button
					onclick={openExportModal}
					data-testid="export-chat-btn"
					class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity"
					style="background: var(--accent); color: var(--bg); font-family: var(--font-mono);"
				>
					<FileText size={14} />
					{m.export_chat_btn()}
				</button>

				<button
					onclick={handleAuditExport}
					disabled={exportingAudit}
					data-testid="export-audit-btn"
					class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
					style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
				>
					{#if exportingAudit}
						<Loader size={14} class="animate-spin" />
						{m.settings_export_downloading()}
					{:else}
						<Download size={14} />
						{m.export_audit_btn()}
					{/if}
				</button>
			</div>
		</section>

		<!-- ═══ EXPORT MODAL ═══ -->
		{#if showExportModal}
			<div
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
				style="background: rgba(0,0,0,0.6);"
			>
				<div
					class="w-full max-w-md rounded-lg p-6"
					style="background: var(--bg-surface); border: 1px solid var(--border); max-height: 80vh; overflow-y: auto;"
				>
					<!-- Header -->
					<div class="mb-4 flex items-center justify-between">
						<div class="flex items-center gap-2">
							{#if exportStep !== 'rooms'}
								<button
									onclick={() => { exportStep = 'rooms'; exportSelectedRoom = null; exportPreview = null; exportError = ''; }}
									class="p-1"
									style="color: var(--text-muted); background: none; border: none; cursor: pointer;"
								>
									<ChevronLeft size={16} />
								</button>
							{/if}
							<h3 class="text-sm font-bold uppercase tracking-wider" style="color: var(--text); font-family: var(--font-mono);">
								{m.export_chat_title()}
							</h3>
						</div>
						<button
							onclick={closeExportModal}
							class="p-1"
							style="color: var(--text-muted); background: none; border: none; cursor: pointer;"
						>
							<X size={16} />
						</button>
					</div>

					{#if exportError}
						<div class="mb-3 rounded-md p-3 text-xs" style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444;">
							{exportError}
						</div>
					{/if}

					<!-- Step: Room selection -->
					{#if exportStep === 'rooms'}
						{#if exportLoading}
							<div class="flex items-center justify-center py-8">
								<Loader size={20} class="animate-spin" style="color: var(--accent);" />
							</div>
						{:else if exportRooms.length === 0}
							<p class="py-4 text-center text-xs" style="color: var(--text-muted);">{m.export_no_rooms()}</p>
						{:else}
							<p class="mb-3 text-xs" style="color: var(--text-muted);">{m.export_select_room()}</p>
							<div class="flex flex-col gap-1.5">
								{#each exportRooms as room (room.id)}
									<button
										onclick={() => selectExportRoom(room)}
										class="flex items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors"
										style="background: var(--bg); border: 1px solid var(--border); color: var(--text); cursor: pointer;"
										data-testid={`export-room-${room.id}`}
									>
										<MessageSquare size={14} style="color: var(--text-muted);" />
										{room.name}
									</button>
								{/each}
							</div>
						{/if}

					<!-- Step: Preview -->
					{:else if exportStep === 'preview'}
						{#if exportLoading}
							<div class="flex items-center justify-center py-8">
								<Loader size={20} class="animate-spin" style="color: var(--accent);" />
							</div>
						{:else if exportPreview}
							<div class="mb-4 rounded-md p-3" style="background: var(--bg); border: 1px solid var(--border);">
								<h4 class="mb-2 text-sm font-semibold" style="color: var(--accent);">{exportPreview.roomName}</h4>
								<div class="flex flex-col gap-1 text-xs" style="color: var(--text-muted); font-family: var(--font-mono);">
									<span>{m.export_messages()}: {exportPreview.messageCount.toLocaleString()}</span>
									<span>{m.export_date_range()}: {exportPreview.dateRange.from ? new Date(exportPreview.dateRange.from).toLocaleDateString() : '—'} — {exportPreview.dateRange.to ? new Date(exportPreview.dateRange.to).toLocaleDateString() : '—'}</span>
								</div>
							</div>

							<!-- Attachment options -->
							{#if exportPreview.photos.count > 0 || exportPreview.files.count > 0}
								<div class="mb-4">
									<p class="mb-2 text-xs font-semibold" style="color: var(--text);">{m.export_include_attachments()}</p>
									{#if exportPreview.photos.count > 0}
										<label class="mb-1.5 flex items-center gap-2 text-xs" style="color: var(--text-muted); cursor: pointer;">
											<input type="checkbox" bind:checked={exportIncludePhotos} />
											<Image size={13} />
											{m.export_photos()} ({exportPreview.photos.count} · {formatBytes(exportPreview.photos.bytes)})
										</label>
									{/if}
									{#if exportPreview.files.count > 0}
										<label class="flex items-center gap-2 text-xs" style="color: var(--text-muted); cursor: pointer;">
											<input type="checkbox" bind:checked={exportIncludeFiles} />
											<Paperclip size={13} />
											{m.export_files()} ({exportPreview.files.count} · {formatBytes(exportPreview.files.bytes)})
										</label>
									{/if}
								</div>
							{/if}

							<div class="mb-3 rounded-md p-2.5 text-xs" style="background: rgba(196,154,60,0.1); border: 1px solid rgba(196,154,60,0.2); color: var(--text-muted);">
								<Mail size={12} style="display: inline; vertical-align: middle; margin-right: 4px;" />
								{m.export_email_notice()}
							</div>

							<button
								onclick={confirmExport}
								data-testid="confirm-export"
								class="flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold"
								style="background: var(--accent); color: var(--bg); font-family: var(--font-mono);"
							>
								<Download size={14} />
								{m.export_confirm()}
							</button>
						{/if}

					<!-- Step: Generating -->
					{:else if exportStep === 'generating'}
						<div class="flex flex-col items-center gap-3 py-8">
							<Loader size={24} class="animate-spin" style="color: var(--accent);" />
							<p class="text-xs" style="color: var(--text-muted);">{m.export_generating()}</p>
						</div>

					<!-- Step: Done -->
					{:else if exportStep === 'done'}
						<div class="flex flex-col items-center gap-3 py-6">
							<div class="flex h-10 w-10 items-center justify-center rounded-full" style="background: rgba(34,197,94,0.15);">
								<Mail size={20} style="color: #22c55e;" />
							</div>
							<p class="text-center text-sm" style="color: var(--text);">{exportDoneMsg}</p>
							<button
								onclick={closeExportModal}
								class="mt-2 rounded-md px-4 py-2 text-sm font-semibold"
								style="background: var(--bg); border: 1px solid var(--border); color: var(--text); cursor: pointer;"
							>
								{m.close()}
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- ═══ BILLING SECTION ═══ -->
		{#if billing}
			<section
				class="mb-6 rounded-lg p-5"
				style="background: var(--bg-surface); border: 1px solid var(--border);"
			>
				<div class="mb-4 flex items-center gap-2">
					<CreditCard size={16} style="color: var(--accent);" />
					<h2
						class="text-sm font-bold uppercase tracking-wider"
						style="color: var(--text); font-family: var(--font-mono);"
					>
						{m.billing_title()}
					</h2>
				</div>

				<!-- Plan badge -->
				<div class="mb-4">
					<span class="mb-1 block text-xs" style="color: var(--text-muted);">
						{m.billing_current_plan()}
					</span>
					<div class="flex items-center gap-2">
						<span
							class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold uppercase tracking-wider"
							style="background: {billing.plan === 'pro'
								? 'color-mix(in oklch, var(--accent) 15%, transparent)'
								: 'var(--bg)'}; border: 1px solid {billing.plan === 'pro'
								? 'color-mix(in oklch, var(--accent) 40%, transparent)'
								: 'var(--border)'}; color: {billing.plan === 'pro'
								? 'var(--accent)'
								: 'var(--text-muted)'}; font-family: var(--font-mono);"
						>
							{#if billing.plan === 'pro'}
								<Crown size={14} />
							{/if}
							{billing.plan === 'pro' ? m.billing_plan_pro() : m.billing_plan_free()}
						</span>
						{#if billing.foundingMember}
							<span
								class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
								style="background: color-mix(in oklch, var(--success) 15%, transparent); color: var(--success);"
							>
								{m.billing_founding()}
							</span>
						{/if}
						{#if billing.status === 'past_due'}
							<span
								class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
								style="background: color-mix(in oklch, var(--danger) 15%, transparent); color: var(--danger);"
							>
								{m.billing_past_due()}
							</span>
						{/if}
					</div>
				</div>

				<!-- Renewal / cancellation info -->
				{#if billing.plan === 'pro' && billing.currentPeriodEnd}
					<div
						class="mb-4 rounded-md px-3 py-2 text-xs"
						style="background: var(--bg); border: 1px solid var(--border); color: var(--text-muted);"
					>
						{#if billing.cancelAtPeriodEnd}
							{m.billing_cancels({ date: formatDate(billing.currentPeriodEnd) })}
						{:else}
							{m.billing_renews({ date: formatDate(billing.currentPeriodEnd) })}
						{/if}
					</div>
				{/if}

				<!-- Usage stats -->
				<div class="mb-4">
					<span class="mb-2 block text-xs" style="color: var(--text-muted);">
						{m.billing_usage()}
					</span>
					<div class="space-y-1.5">
						<div
							class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						>
							<Users size={12} style="color: var(--text-muted); flex-shrink: 0;" />
							{m.billing_users({ count: String(billing.usage.users), limit: fmtLimit(billing.limits.maxUsers) })}
						</div>
						<div
							class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						>
							<Bot size={12} style="color: var(--text-muted); flex-shrink: 0;" />
							{m.billing_agents({ count: String(billing.usage.agents), limit: fmtLimit(billing.limits.maxAgents) })}
						</div>
						<div
							class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						>
							<MessageSquare size={12} style="color: var(--text-muted); flex-shrink: 0;" />
							{m.billing_messages({ count: String(billing.usage.msgsToday), limit: fmtLimit(billing.limits.maxMsgsPerDay) })}
						</div>
						<div
							class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						>
							<LayoutGrid size={12} style="color: var(--text-muted); flex-shrink: 0;" />
							{m.billing_rooms({ count: String(roomCount), limit: fmtLimit(billing.limits.maxRooms) })}
						</div>
						<div
							class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						>
							<Upload size={12} style="color: var(--text-muted); flex-shrink: 0;" />
							{m.billing_uploads_count({ count: String(billing.usage.uploads), limit: fmtLimit(billing.limits.maxUploads) })}
						</div>
					</div>
				</div>

				<!-- Billing errors / success -->
				{#if billingError}
					<div
						class="mb-3 rounded-md px-3 py-2 text-xs"
						style="background: color-mix(in oklch, var(--danger) 10%, transparent); color: var(--danger);"
						role="alert"
					>
						{billingError}
					</div>
				{/if}
				{#if billingVerifying}
				<div
					class="mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs"
					style="background: color-mix(in oklch, var(--accent) 10%, transparent); color: var(--accent);"
					role="status"
				>
					<Loader size={14} class="animate-spin" />
					Activating your subscription...
				</div>
			{/if}
			{#if billingSuccess}
					<div
						class="mb-3 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs"
						style="background: color-mix(in oklch, var(--success) 10%, transparent); color: var(--success);"
						role="status"
					>
						<Check size={14} />
						{billingSuccess}
					</div>
				{/if}

				<!-- Action buttons (owner/lead only) -->
				{#if isOwnerOrLead}
					{#if billing.plan === 'free'}
						<!-- Interval toggle -->
						<div class="mb-3 flex items-center gap-1 rounded-md p-1" style="background: var(--bg); border: 1px solid var(--border); width: fit-content;">
							<button
								onclick={() => (upgradeInterval = 'month')}
								data-testid="interval-monthly-btn"
								class="rounded px-3 py-1 text-xs font-semibold transition-all"
								style="background: {upgradeInterval === 'month' ? 'var(--accent)' : 'transparent'}; color: {upgradeInterval === 'month' ? 'var(--bg)' : 'var(--text-muted)'}; font-family: var(--font-mono);"
							>
								$10 / mo
							</button>
							<button
								onclick={() => (upgradeInterval = 'year')}
								data-testid="interval-annual-btn"
								class="inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-all"
								style="background: {upgradeInterval === 'year' ? 'var(--accent)' : 'transparent'}; color: {upgradeInterval === 'year' ? 'var(--bg)' : 'var(--text-muted)'}; font-family: var(--font-mono);"
							>
								$96 / yr
								<span
									class="rounded px-1 py-0.5 text-[9px] font-bold uppercase"
									style="background: {upgradeInterval === 'year' ? 'color-mix(in oklch, var(--bg) 25%, transparent)' : 'color-mix(in oklch, var(--success) 20%, transparent)'}; color: {upgradeInterval === 'year' ? 'var(--bg)' : 'var(--success)'};"
								>save 20%</span>
							</button>
						</div>
						<button
							onclick={handleUpgrade}
							disabled={upgrading}
							data-testid="upgrade-btn"
							class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
							style="background: var(--accent); color: var(--bg); letter-spacing: 0.5px; font-family: var(--font-mono);"
						>
							{#if upgrading}
								<Loader size={14} class="animate-spin" />
								{m.billing_upgrading()}
							{:else}
								<Crown size={14} />
								{m.billing_upgrade()}
							{/if}
						</button>
					{:else}
						<button
							onclick={handleManageBilling}
							disabled={managing}
							data-testid="manage-billing-btn"
							class="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						>
							{#if managing}
								<Loader size={14} class="animate-spin" />
								{m.billing_managing()}
							{:else}
								<CreditCard size={14} />
								{m.billing_manage()}
							{/if}
						</button>
					{/if}
				{/if}
			</section>
		{/if}

		<!-- ═══ TEAM SECTION ═══ -->
		<section
			class="mb-6 rounded-lg p-5"
			style="background: var(--bg-surface); border: 1px solid var(--border);"
		>
			<div class="mb-4 flex items-center gap-2">
				<Users size={16} style="color: var(--accent);" />
				<h2
					class="text-sm font-bold uppercase tracking-wider"
					style="color: var(--text); font-family: var(--font-mono);"
				>
					Team
				</h2>
			</div>

			{#if team}
				<!-- User owns a team -->
				<div class="mb-4 space-y-2">
					<div>
						<span class="mb-1 block text-xs" style="color: var(--text-muted);">Team name</span>
						<span class="text-sm font-semibold" style="color: var(--text);">{team.name}</span>
					</div>
					<div class="flex flex-wrap gap-3 text-xs" style="color: var(--text-muted);">
						<span
							class="inline-flex items-center gap-1 rounded px-2 py-1"
							style="background: color-mix(in oklch, var(--accent) 12%, transparent); color: var(--accent); font-family: var(--font-mono);"
						>
							<Crown size={11} />
							{team.status === 'active' ? 'Active' : team.status}
						</span>
						<span class="inline-flex items-center gap-1">
							<Users size={11} />
							{team.seats} seat{team.seats === 1 ? '' : 's'}
						</span>
						{#if team.currentPeriodEnd}
							<span>Renews {new Date(team.currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
						{/if}
					</div>
				</div>
				<a
					href="/settings/team"
					data-testid="manage-team-btn"
					class="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
					style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
				>
					<Users size={14} />
					Manage Team Members
				</a>
			{:else if hasTeamPro}
				<!-- User is a member of a team (Pro via Team) -->
				<div class="flex items-center gap-3">
					<span
						class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold uppercase tracking-wider"
						style="background: color-mix(in oklch, var(--accent) 15%, transparent); border: 1px solid color-mix(in oklch, var(--accent) 40%, transparent); color: var(--accent); font-family: var(--font-mono);"
					>
						<Crown size={14} />
						Pro via Team
					</span>
					<span class="text-xs" style="color: var(--text-muted);">
						Your Pro access is provided by a team subscription.
					</span>
				</div>
			{:else}
				<!-- No team — CTA to create one -->
				<p class="mb-4 text-xs" style="color: var(--text-muted);">
					Collaborate with your organization. A team subscription gives everyone on your team Pro access under one invoice.
				</p>
				<a
					href="/settings/team"
					data-testid="create-team-btn"
					class="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
					style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
				>
					<Users size={14} />
					Create a Team
				</a>
			{/if}
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
						class="w-full rounded-md px-3 py-2.5 text-sm"
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

		<!-- ═══ FOOTER LINKS ═══ -->
		<div
			class="mt-6 mb-8 flex items-center justify-center gap-6 text-xs"
			style="color: var(--text-muted);"
		>
			<a
				href="/docs"
				class="inline-flex items-center gap-1.5 transition-opacity hover:opacity-80"
				style="color: var(--text-muted);"
			>
				<BookOpen size={14} />
				Guide
			</a>
			<a
				href="/support"
				class="inline-flex items-center gap-1.5 transition-opacity hover:opacity-80"
				style="color: var(--text-muted);"
			>
				<LifeBuoy size={14} />
				Support
			</a>
		</div>
	</div>
</div>
