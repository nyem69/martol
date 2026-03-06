<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { X, ChevronDown, Check, Copy, ExternalLink, KeyRound, Trash2, Loader, LogOut, Send } from '@lucide/svelte';
	import { organization } from '$lib/auth-client';
	import { getAvailableCommands } from '$lib/chat/commands';
	import { themeStore, THEMES } from '$lib/stores/theme.svelte';
	import { signOut } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import type { SvelteMap } from 'svelte/reactivity';

	interface Invitation {
		id: string;
		email: string;
		role: string;
		status: string;
		createdAt: string;
		hasAccount: boolean;
		username: string | null;
	}

	let {
		open = false,
		onClose,
		onlineUsers,
		userRole = 'member',
		roomId = '',
		invitations = [],
		hmacSecret = null
	}: {
		open: boolean;
		onClose: () => void;
		onlineUsers: SvelteMap<string, { name: string; role: string }>;
		userRole?: string;
		roomId?: string;
		invitations?: Invitation[];
		hmacSecret?: string | null;
	} = $props();

	// Collapsible section state — members open by default, rest collapsed
	let sectionsOpen = $state<Record<string, boolean>>({
		members: true,
		invite: false,
		guide: false,
		theme: false,
		agentSetup: false,
		legal: false
	});

	// Copy-to-clipboard feedback
	let copiedField = $state<string | null>(null);
	let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

	function copyToClipboard(text: string, field: string) {
		navigator.clipboard.writeText(text);
		copiedField = field;
		clearTimeout(copiedTimeout);
		copiedTimeout = setTimeout(() => (copiedField = null), 1500);
	}

	// Derive connection URLs from current page
	const wsUrl = $derived(
		typeof window !== 'undefined'
			? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/rooms/${roomId}/ws`
			: ''
	);
	const mcpUrl = $derived(
		typeof window !== 'undefined'
			? `${window.location.origin}/mcp/v1`
			: ''
	);

	function toggleSection(id: string) {
		sectionsOpen[id] = !sectionsOpen[id];
	}

	// Map command description keys to paraglide message functions
	const cmdDescriptions: Record<string, () => string> = {
		chat_slash_approve: m.chat_slash_approve,
		chat_slash_reject: m.chat_slash_reject,
		chat_slash_actions: m.chat_slash_actions,
		chat_slash_clear: m.chat_slash_clear,
		chat_slash_continue: m.chat_slash_continue,
		chat_slash_whois: m.chat_slash_whois
	};

	// Map theme name keys to paraglide message functions
	const themeNames: Record<string, () => string> = {
		theme_forge: m.theme_forge,
		theme_obsidian: m.theme_obsidian,
		theme_parchment: m.theme_parchment,
		theme_neon: m.theme_neon,
		theme_patina: m.theme_patina,
		theme_daybreak: m.theme_daybreak
	};

	const commands = $derived(
		getAvailableCommands(userRole).map((cmd) => ({
			name: cmd.name,
			desc: cmdDescriptions[cmd.description]?.() ?? cmd.description
		}))
	);

	const shortcuts = [
		{ keys: 'Enter', desc: () => m.guide_enter_send() },
		{ keys: 'Shift + Enter', desc: () => m.guide_shift_enter() },
		{ keys: 'End', desc: () => m.guide_end_key() },
		{ keys: '@', desc: () => m.guide_at_mention() },
		{ keys: '/', desc: () => m.guide_slash_command() }
	];

	const features = [
		() => m.guide_markdown(),
		() => m.guide_reply(),
		() => m.guide_scroll_history()
	];

	// ── Agent key management state ──
	let registeredAgents = $state<Array<{agentUserId: string, name: string, keyStart: string | null, createdAt: string | null}>>([]);
	let newAgentName = $state('');
	let generatedKey = $state<string | null>(null);
	let generatedAgentName = $state('');
	let agentLoading = $state(false);
	let agentError = $state('');
	let agentsFetched = $state(false);

	// ── Confirm dialog state ──
	let confirmTarget = $state<{ agentUserId: string; name: string } | null>(null);
	let confirmBtn = $state<HTMLButtonElement | undefined>();
	let confirmPrevFocus: HTMLElement | null = null;

	const canManageAgents = $derived(userRole === 'owner' || userRole === 'lead');

	async function fetchAgents() {
		try {
			const res = await fetch('/api/agents');
			const data: { ok?: boolean; data?: typeof registeredAgents } = await res.json();
			if (data.ok && data.data) registeredAgents = data.data;
		} catch { /* silent */ }
		agentsFetched = true;
	}

	async function createAgent() {
		agentError = '';
		generatedKey = null;
		agentLoading = true;
		try {
			const res = await fetch('/api/agents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newAgentName })
			});
			const data: { ok?: boolean; data?: { key?: string }; message?: string; error?: string } = await res.json();
			if (!res.ok || !data.ok) {
				agentError = data.message || data.error || 'Failed to create agent';
				return;
			}
			generatedKey = data.data?.key ?? null;
			generatedAgentName = newAgentName;
			newAgentName = '';
			await fetchAgents();
		} catch {
			agentError = 'Network error';
		} finally {
			agentLoading = false;
		}
	}

	function promptRevoke(agentUserId: string, name: string) {
		confirmPrevFocus = document.activeElement as HTMLElement;
		confirmTarget = { agentUserId, name };
		// Focus confirm button after render
		requestAnimationFrame(() => confirmBtn?.focus());
	}

	function cancelRevoke() {
		confirmTarget = null;
		confirmPrevFocus?.focus();
	}

	async function executeRevoke() {
		if (!confirmTarget) return;
		const { agentUserId } = confirmTarget;
		confirmTarget = null;
		confirmPrevFocus?.focus();
		try {
			const res = await fetch(`/api/agents/${agentUserId}`, { method: 'DELETE' });
			const data: { ok?: boolean; message?: string } = await res.json();
			if (data.ok) {
				registeredAgents = registeredAgents.filter((a) => a.agentUserId !== agentUserId);
			} else {
				agentError = data.message || 'Failed to revoke agent';
			}
		} catch (e) {
			agentError = 'Network error revoking agent';
		}
	}

	// Fetch agents when agentSetup section opens
	$effect(() => {
		if (sectionsOpen.agentSetup && !agentsFetched) {
			fetchAgents();
		}
	});

	// Agents are identified by 'agent' role
	const agents = $derived(
		[...onlineUsers.entries()]
			.filter(([_, u]) => u.role === 'agent' || u.name.includes(':'))
			.map(([id, u]) => ({ id, name: u.name, role: u.role }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	const humans = $derived(
		[...onlineUsers.entries()]
			.filter(([_, u]) => u.role !== 'agent' && !u.name.includes(':'))
			.map(([id, u]) => ({ id, name: u.name, role: u.role }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	// ── Invite member state ──
	const canInvite = $derived(userRole === 'owner' || userRole === 'lead');
	let inviteEmail = $state('');
	let inviteRole = $state('member');
	let inviteLoading = $state(false);
	let inviteStatus = $state<{ type: 'success' | 'error'; message: string } | null>(null);
	let sentEmails = $state(new Set<string>());
	const isResend = $derived(sentEmails.has(inviteEmail.trim().toLowerCase()));

	async function sendInvite() {
		const email = inviteEmail.trim();
		if (!email || inviteLoading) return;
		inviteLoading = true;
		inviteStatus = null;
		try {
			const res = await organization.inviteMember({
				email,
				role: inviteRole as 'member' | 'admin',
				organizationId: roomId,
				resend: isResend
			});
			if (res.error) {
				inviteStatus = { type: 'error', message: res.error.message || m.chat_invite_error() };
			} else {
				inviteStatus = { type: 'success', message: m.chat_invite_success() };
				sentEmails.add(email.toLowerCase());
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : m.chat_invite_error();
			inviteStatus = { type: 'error', message: msg };
		} finally {
			inviteLoading = false;
		}
	}

	let loggingOut = $state(false);

	async function handleLogout() {
		loggingOut = true;
		try {
			await signOut();
			goto('/');
		} catch {
			loggingOut = false;
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<button
		class="fixed inset-0 z-30 bg-black/50"
		onclick={onClose}
		aria-label={m.chat_close_panel()}
		tabindex="-1"
	></button>
{/if}

<aside
	class="panel-aside fixed top-0 right-0 z-40 flex h-full flex-col border-l transition-transform duration-200"
	style="background: var(--bg-elevated); border-color: var(--border);
		transform: {open ? 'translateX(0)' : 'translateX(100%)'};"
	aria-label={m.panel_title()}
>
	<!-- Header -->
	<div
		class="flex items-center justify-between px-4 py-3"
		style="border-bottom: 1px solid var(--border); padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));"
	>
		<span class="text-xs font-bold uppercase tracking-wider" style="color: var(--text-muted);">
			{m.panel_title()}
		</span>
		<button
			class="rounded p-1 transition-opacity hover:opacity-70"
			style="color: var(--text-muted);"
			onclick={onClose}
			aria-label={m.chat_close_panel()}
		>
			<X size={16} />
		</button>
	</div>

	<div class="scrollbar-thin flex-1 overflow-y-auto">
		<!-- ═══ MEMBERS SECTION ═══ -->
		<div style="border-bottom: 1px solid var(--border);">
			<button
				class="section-toggle flex w-full items-center justify-between px-4 py-2.5"
				onclick={() => toggleSection('members')}
				aria-expanded={sectionsOpen.members}
			>
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted); font-family: var(--font-mono);">
					{m.chat_members()} — {onlineUsers.size}
				</span>
				<span
					class="transition-transform duration-150"
					style="color: var(--text-muted); transform: rotate({sectionsOpen.members ? '0' : '-90'}deg);"
				>
					<ChevronDown size={14} />
				</span>
			</button>

			<div
				class="section-body"
				style="display: grid; grid-template-rows: {sectionsOpen.members ? '1fr' : '0fr'}; transition: grid-template-rows 200ms ease;"
			>
				<div style="overflow: hidden;">
					<div class="px-4 pb-3">
						<!-- Agents -->
						{#if agents.length > 0}
							<div class="mb-3">
								<h4
									class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
									style="color: var(--accent-muted); font-family: var(--font-mono);"
								>
									{m.chat_agents()} — {agents.length}
								</h4>
								{#each agents as agent (agent.id)}
									<div class="flex items-center gap-2 py-1">
										<span
											class="inline-block h-2 w-2 shrink-0 rounded-full"
											style="background: var(--success);"
											aria-hidden="true"
										></span>
										<span class="truncate text-sm" style="color: var(--text);">
											{agent.name}
										</span>
										<span
											class="ml-auto text-[10px] uppercase"
											style="color: var(--text-muted); font-family: var(--font-mono);"
										>
											{m.status_online()}
										</span>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Humans -->
						<div>
							<h4
								class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
								style="color: var(--accent-muted); font-family: var(--font-mono);"
							>
								{m.chat_users()} — {humans.length}
							</h4>
							{#each humans as user (user.id)}
								<div class="flex items-center gap-2 py-1">
									<span
										class="inline-block h-2 w-2 shrink-0 rounded-full"
										style="background: var(--info);"
										aria-hidden="true"
									></span>
									<span class="truncate text-sm" style="color: var(--text);">
										{user.name}
									</span>
									<span
										class="ml-auto text-[10px] uppercase"
										style="color: var(--text-muted); font-family: var(--font-mono);"
									>
										{m.status_online()}
									</span>
								</div>
							{/each}
							{#if humans.length === 0}
								<p class="text-xs" style="color: var(--text-muted);">
									{m.chat_no_members()}
								</p>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- ═══ INVITE SECTION (owner/lead only) ═══ -->
		{#if canInvite}
			<div style="border-bottom: 1px solid var(--border);">
				<button
					class="section-toggle flex w-full items-center justify-between px-4 py-2.5"
					onclick={() => toggleSection('invite')}
					aria-expanded={sectionsOpen.invite}
				>
					<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted); font-family: var(--font-mono);">
						{m.chat_invite_title()}
					</span>
					<span
						class="transition-transform duration-150"
						style="color: var(--text-muted); transform: rotate({sectionsOpen.invite ? '0' : '-90'}deg);"
					>
						<ChevronDown size={14} />
					</span>
				</button>

				<div
					class="section-body"
					style="display: grid; grid-template-rows: {sectionsOpen.invite ? '1fr' : '0fr'}; transition: grid-template-rows 200ms ease;"
				>
					<div style="overflow: hidden;">
						<div class="px-4 pb-3">
							<form
								class="flex flex-col gap-2"
								onsubmit={(e) => { e.preventDefault(); sendInvite(); }}
							>
								<input
									type="email"
									bind:value={inviteEmail}
									placeholder={m.chat_invite_email_placeholder()}
									class="agent-input"
									data-testid="invite-email-input"
								/>
								<div class="flex items-center gap-2">
									<select
										bind:value={inviteRole}
										class="agent-input flex-1"
										data-testid="invite-role-select"
									>
										<option value="member">{m.role_member()}</option>
										<option value="admin">{m.role_lead()}</option>
									</select>
									<button
										type="submit"
										class="agent-btn"
										disabled={inviteLoading || !inviteEmail.trim() || (inviteStatus?.type === 'success' && !isResend)}
										data-testid="invite-send-btn"
									>
										{#if inviteLoading}
											<Loader size={11} class="animate-spin" />
											{m.chat_invite_sending()}
										{:else if isResend}
											<Send size={11} />
											{m.chat_invite_resend()}
										{:else}
											<Send size={11} />
											{m.chat_invite_send()}
										{/if}
									</button>
								</div>
							</form>

							{#if inviteStatus}
								<div
									class="mt-2 rounded px-2 py-1 text-[10px]"
									style="background: color-mix(in oklch, var({inviteStatus.type === 'success' ? '--success' : '--danger'}) 15%, transparent); color: var({inviteStatus.type === 'success' ? '--success' : '--danger'});"
								>
									{inviteStatus.message}
								</div>
							{/if}

							<!-- Invited users list -->
							{#if invitations.length > 0}
								<div class="mt-3" style="border-top: 1px solid var(--border); padding-top: 0.75rem;">
									<h4 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted); font-family: var(--font-mono);">
										{m.chat_invite_list()} — {invitations.length}
									</h4>
									<div class="flex flex-col gap-1">
										{#each invitations as inv (inv.id)}
											<div class="flex items-center gap-2 py-1">
												<!-- Status dot -->
												<span
													class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
													style="background: var({inv.status === 'accepted' ? '--success' : inv.status === 'pending' ? '--warning' : '--danger'});"
													aria-hidden="true"
												></span>
												<div class="flex min-w-0 flex-1 flex-col">
													{#if inv.hasAccount && inv.username}
														<span class="flex items-center gap-1 truncate text-[11px] font-medium" style="color: var(--text);">
															{inv.username}
															<Check size={10} style="color: var(--success);" />
														</span>
														<span class="truncate text-[10px]" style="color: var(--text-muted);">{inv.email}</span>
													{:else}
														<span class="truncate text-[11px]" style="color: var(--text);">{inv.email}</span>
													{/if}
												</div>
												<div class="flex shrink-0 flex-col items-end gap-0.5">
													<span
														class="text-[9px] uppercase"
														style="color: var(--text-muted); font-family: var(--font-mono);"
													>
														{inv.status}
													</span>
													<span class="text-[9px]" style="color: var(--text-muted);">
														{new Date(inv.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
													</span>
												</div>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- ═══ THEME SECTION ═══ -->
		<div style="border-bottom: 1px solid var(--border);">
			<button
				class="section-toggle flex w-full items-center justify-between px-4 py-2.5"
				onclick={() => toggleSection('theme')}
				aria-expanded={sectionsOpen.theme}
			>
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted); font-family: var(--font-mono);">
					{m.theme_title()}
				</span>
				<span
					class="transition-transform duration-150"
					style="color: var(--text-muted); transform: rotate({sectionsOpen.theme ? '0' : '-90'}deg);"
				>
					<ChevronDown size={14} />
				</span>
			</button>

			<div
				class="section-body"
				style="display: grid; grid-template-rows: {sectionsOpen.theme ? '1fr' : '0fr'}; transition: grid-template-rows 200ms ease;"
			>
				<div style="overflow: hidden;">
					<div class="grid grid-cols-2 gap-2 px-4 pb-3">
						{#each THEMES as theme (theme.id)}
							<button
								class="theme-swatch group relative rounded-lg p-2 text-left transition-all duration-150"
								style="
									background: {theme.preview[0]};
									border: 2px solid {themeStore.current === theme.id ? theme.preview[2] : 'transparent'};
									box-shadow: {themeStore.current === theme.id ? `0 0 0 1px ${theme.preview[2]}33` : 'none'};
								"
								onclick={() => themeStore.set(theme.id)}
								aria-pressed={themeStore.current === theme.id}
							>
								<!-- Swatch color bars -->
								<div class="mb-1.5 flex gap-1">
									<div
										class="h-3 flex-1 rounded-sm"
										style="background: {theme.preview[1]};"
									></div>
									<div
										class="h-3 w-5 rounded-sm"
										style="background: {theme.preview[2]};"
									></div>
								</div>
								<!-- Theme name -->
								<div class="flex items-center gap-1">
									{#if themeStore.current === theme.id}
										<span style="color: {theme.preview[2]};">
											<Check size={10} strokeWidth={3} />
										</span>
									{/if}
									<span
										class="text-[10px] font-semibold uppercase tracking-wide"
										style="color: {theme.preview[3]}; font-family: var(--font-mono);"
									>
										{themeNames[theme.nameKey]?.() ?? theme.id}
									</span>
								</div>
							</button>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- ═══ QUICK GUIDE SECTION ═══ -->
		<div style="border-bottom: 1px solid var(--border);">
			<button
				class="section-toggle flex w-full items-center justify-between px-4 py-2.5"
				onclick={() => toggleSection('guide')}
				aria-expanded={sectionsOpen.guide}
			>
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted); font-family: var(--font-mono);">
					{m.guide_title()}
				</span>
				<span
					class="transition-transform duration-150"
					style="color: var(--text-muted); transform: rotate({sectionsOpen.guide ? '0' : '-90'}deg);"
				>
					<ChevronDown size={14} />
				</span>
			</button>

			<div
				class="section-body"
				style="display: grid; grid-template-rows: {sectionsOpen.guide ? '1fr' : '0fr'}; transition: grid-template-rows 200ms ease;"
			>
				<div style="overflow: hidden;">
					<div class="px-4 pb-3">
						<!-- Commands -->
						{#if commands.length > 0}
							<div class="mb-3">
								<h4 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
									{m.guide_commands()}
								</h4>
								{#each commands as cmd}
									<div class="flex items-baseline gap-2 py-0.5">
										<code
											class="shrink-0 text-xs"
											style="color: var(--accent); font-family: var(--font-mono);"
										>/{cmd.name}</code>
										<span class="text-[11px]" style="color: var(--text-muted);">
											{cmd.desc}
										</span>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Shortcuts -->
						<div class="mb-3">
							<h4 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								{m.guide_shortcuts()}
							</h4>
							{#each shortcuts as shortcut}
								<div class="flex items-baseline gap-2 py-0.5">
									<kbd
										class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
										style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
									>{shortcut.keys}</kbd>
									<span class="text-[11px]" style="color: var(--text-muted);">{shortcut.desc()}</span>
								</div>
							{/each}
						</div>

						<!-- Features -->
						<div class="mb-3">
							<h4 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								{m.guide_features()}
							</h4>
							{#each features as feature}
								<div class="flex items-center gap-2 py-0.5">
									<span
										class="inline-block h-1 w-1 shrink-0 rounded-full"
										style="background: var(--border);"
										aria-hidden="true"
									></span>
									<span class="text-[11px]" style="color: var(--text-muted);">{feature()}</span>
								</div>
							{/each}
						</div>

						<!-- Documentation link -->
						<a
							href="/docs"
							target="_blank"
							class="flex items-center gap-1.5 text-[11px] font-medium"
							style="color: var(--accent);"
						>
							<ExternalLink size={12} />
							{m.guide_documentation()}
						</a>
					</div>
				</div>
			</div>
		</div>
		<!-- ═══ AGENT SETUP SECTION ═══ -->
		<div style="border-bottom: 1px solid var(--border);">
			<button
				class="section-toggle flex w-full items-center justify-between px-4 py-2.5"
				onclick={() => toggleSection('agentSetup')}
				aria-expanded={sectionsOpen.agentSetup}
			>
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted); font-family: var(--font-mono);">
					{m.agent_setup_title()}
				</span>
				<span
					class="transition-transform duration-150"
					style="color: var(--text-muted); transform: rotate({sectionsOpen.agentSetup ? '0' : '-90'}deg);"
				>
					<ChevronDown size={14} />
				</span>
			</button>

			<div
				class="section-body"
				style="display: grid; grid-template-rows: {sectionsOpen.agentSetup ? '1fr' : '0fr'}; transition: grid-template-rows 200ms ease;"
			>
				<div style="overflow: hidden;">
					<div class="px-4 pb-3">
						<!-- ── HMAC Secret (owner/lead only) ── -->
						{#if hmacSecret && canManageAgents}
							<div class="mb-3">
								<h4 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
									{m.agent_setup_connection()}
								</h4>
								<div class="param-row">
									<div class="flex items-center justify-between">
										<code class="param-label">MARTOL_HMAC_SECRET</code>
										<button
											class="copy-btn"
											onclick={() => copyToClipboard(hmacSecret!, 'hmac')}
											aria-label="Copy"
										>
											{#if copiedField === 'hmac'}
												<Check size={10} />
											{:else}
												<Copy size={10} />
											{/if}
										</button>
									</div>
									<div class="param-value">{hmacSecret}</div>
								</div>
							</div>
						{/if}

						<!-- ── Generate Agent Key (owner/lead only) ── -->
						{#if canManageAgents}
							<div class="mb-3">
								<h4 class="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
									<KeyRound size={11} />
									{m.agent_generate_title()}
								</h4>

								<div class="mb-2 flex flex-col gap-1.5">
									<input
										type="text"
										bind:value={newAgentName}
										placeholder={m.agent_label_placeholder()}
										class="agent-input"
										data-testid="agent-name-input"
									/>
									<button
										class="agent-btn"
										onclick={createAgent}
										disabled={agentLoading || !newAgentName.trim()}
										data-testid="agent-generate-btn"
									>
										{#if agentLoading}
											<Loader size={11} class="animate-spin" />
											{m.agent_generating()}
										{:else}
											<KeyRound size={11} />
											{m.agent_generate_btn()}
										{/if}
									</button>
								</div>

								{#if agentError}
									<div class="mb-2 rounded px-2 py-1 text-[10px]" style="background: color-mix(in oklch, var(--danger) 15%, transparent); color: var(--danger);">
										{agentError}
									</div>
								{/if}

								{#if generatedKey}
									<div class="mb-2 rounded p-2" style="background: color-mix(in oklch, var(--success) 10%, transparent); border: 1px solid color-mix(in oklch, var(--success) 30%, transparent);">
										{#if generatedAgentName}
											<div class="mb-1 text-[11px] font-bold" style="color: var(--text);">
												{generatedAgentName}
											</div>
										{/if}
										<div class="mb-1 text-[10px] font-semibold" style="color: var(--success);">
											{m.agent_key_warning()}
										</div>
										<div class="flex items-center gap-1">
											<code class="flex-1 break-all text-[10px]" style="color: var(--text); font-family: var(--font-mono);">
												{generatedKey}
											</code>
											<button
												class="copy-btn"
												onclick={() => copyToClipboard(generatedKey!, 'agentKey')}
												aria-label="Copy"
											>
												{#if copiedField === 'agentKey'}
													<Check size={10} />
												{:else}
													<Copy size={10} />
												{/if}
											</button>
										</div>
									</div>
								{/if}
							</div>
						{/if}

						<!-- ── Active Agents ── -->
						<div class="mb-3" style="border-top: 1px solid var(--border); padding-top: 0.75rem;">
							<h4 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								{m.agent_active_title()}
							</h4>

							{#if registeredAgents.length === 0}
								<p class="text-[10px]" style="color: var(--text-muted);">
									{m.agent_no_agents()}
								</p>
							{:else}
								<div class="flex flex-col gap-1.5">
									{#each registeredAgents as agent (agent.agentUserId)}
										<div class="rounded p-1.5" style="background: var(--bg); border: 1px solid var(--border);">
											<div class="flex items-center justify-between">
												<span class="text-[11px] font-semibold" style="color: var(--text); font-family: var(--font-mono);">
													{agent.name}
												</span>
												<div class="flex items-center gap-1">
													<button
														class="copy-btn"
														onclick={() => copyToClipboard(agent.name, `agent-${agent.agentUserId}`)}
														aria-label="Copy name"
													>
														{#if copiedField === `agent-${agent.agentUserId}`}
															<Check size={10} />
														{:else}
															<Copy size={10} />
														{/if}
													</button>
													{#if canManageAgents}
														<button
															class="rounded p-0.5 transition-colors hover:opacity-80"
															style="color: var(--danger);"
															onclick={() => promptRevoke(agent.agentUserId, agent.name)}
															aria-label={m.agent_revoke()}
															data-testid="agent-revoke-btn"
														>
															<Trash2 size={11} />
														</button>
													{/if}
												</div>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>

						<!-- ── Connection Details ── -->
						<div class="mb-3" style="border-top: 1px solid var(--border); padding-top: 0.75rem;">
							<h4 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								{m.agent_setup_connection()}
							</h4>

							<!-- WS URL -->
							<div class="param-row">
								<div class="flex items-center justify-between">
									<code class="param-label">MARTOL_WS_URL</code>
									<button
										class="copy-btn"
										onclick={() => copyToClipboard(wsUrl, 'ws')}
										aria-label="Copy"
									>
										{#if copiedField === 'ws'}
											<Check size={10} />
										{:else}
											<Copy size={10} />
										{/if}
									</button>
								</div>
								<div class="param-value">{wsUrl}</div>
							</div>
						</div>

						<!-- Client repo link -->
						<a
							href="https://github.com/nyem69/martol-client"
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex items-center gap-1 text-[11px] transition-opacity hover:opacity-80"
							style="color: var(--accent);"
						>
							<ExternalLink size={11} />
							{m.agent_setup_repo()}
						</a>
					</div>
				</div>
			</div>
		</div>
		<!-- ═══ LEGAL SECTION ═══ -->
		<div style="border-bottom: 1px solid var(--border);">
			<button
				class="section-toggle flex w-full items-center justify-between px-4 py-2.5"
				onclick={() => toggleSection('legal')}
				aria-expanded={sectionsOpen.legal}
			>
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted); font-family: var(--font-mono);">
					{m.legal_title()}
				</span>
				<span
					class="transition-transform duration-150"
					style="color: var(--text-muted); transform: rotate({sectionsOpen.legal ? '0' : '-90'}deg);"
				>
					<ChevronDown size={14} />
				</span>
			</button>

			<div
				class="section-body"
				style="display: grid; grid-template-rows: {sectionsOpen.legal ? '1fr' : '0fr'}; transition: grid-template-rows 200ms ease;"
			>
				<div style="overflow: hidden;">
					<div class="flex flex-col gap-1.5 px-4 pb-3">
						<a
							href="/legal/terms"
							class="inline-flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80"
							style="color: var(--accent);"
						>
							{m.legal_terms()}
						</a>
						<a
							href="/legal/privacy"
							class="inline-flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80"
							style="color: var(--accent);"
						>
							{m.legal_privacy()}
						</a>
						<a
							href="/legal/aup"
							class="inline-flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80"
							style="color: var(--accent);"
						>
							{m.legal_anthropic_terms()}
						</a>
						<a
							href="https://www.anthropic.com/legal/privacy"
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80"
							style="color: var(--accent);"
						>
							<ExternalLink size={11} />
							{m.legal_anthropic_privacy()}
						</a>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Logout button pinned to bottom -->
	<div
		class="px-4 py-3"
		style="border-top: 1px solid var(--border); padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));"
	>
		<button
			class="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
			style="background: color-mix(in oklch, var(--danger) 12%, transparent); color: var(--danger); font-family: var(--font-mono);"
			onclick={handleLogout}
			disabled={loggingOut}
			data-testid="logout-btn"
		>
			{#if loggingOut}
				<Loader size={14} class="animate-spin" />
			{:else}
				<LogOut size={14} />
			{/if}
			{m.auth_sign_out()}
		</button>
	</div>
</aside>

<!-- ═══ CONFIRM REVOKE DIALOG ═══ -->
{#if confirmTarget}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-revoke-title"
			tabindex="-1"
			class="mx-4 w-full max-w-sm rounded-lg p-5 shadow-xl"
			style="background: var(--bg-elevated); border: 1px solid var(--border);"
			onkeydown={(e) => {
				if (e.key === 'Escape') cancelRevoke();
			}}
		>
			<h3
				id="confirm-revoke-title"
				class="mb-1 text-sm font-bold"
				style="color: var(--text);"
			>
				{m.agent_revoke()} — {confirmTarget.name}
			</h3>
			<p class="mb-5 text-xs" style="color: var(--text-muted);">
				{m.agent_revoke_confirm()}
			</p>
			<div class="flex justify-end gap-2">
				<button
					class="rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
					style="background: var(--bg-surface); color: var(--text-muted); border: 1px solid var(--border); font-family: var(--font-mono);"
					onclick={cancelRevoke}
				>
					{m.cancel()}
				</button>
				<button
					bind:this={confirmBtn}
					class="rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
					style="background: var(--danger); color: #fff; font-family: var(--font-mono);"
					onclick={executeRevoke}
				>
					{m.agent_revoke()}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Panel width: full on small phones, fixed on larger screens */
	.panel-aside {
		width: 100%;
	}

	@media (min-width: 420px) {
		.panel-aside {
			width: 18rem; /* 288px, same as w-72 */
		}
	}

	.section-toggle {
		cursor: pointer;
		background: none;
		border: none;
		text-align: left;
	}

	.section-toggle:hover {
		background: color-mix(in oklch, var(--bg-surface) 50%, transparent);
	}

	.theme-swatch:hover {
		opacity: 0.9;
		transform: scale(1.02);
	}

	.theme-swatch:active {
		transform: scale(0.98);
	}

	.param-row {
		padding: 0.375rem 0;
		border-bottom: 1px solid color-mix(in oklch, var(--border) 30%, transparent);
	}

	.param-row:last-child {
		border-bottom: none;
	}

	.param-label {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--accent);
	}

	.param-value {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text);
		word-break: break-all;
		padding: 0.125rem 0;
	}

	.copy-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-muted);
		padding: 0.125rem;
		border-radius: 0.25rem;
		transition: color 150ms ease;
		flex-shrink: 0;
	}

	.copy-btn:hover {
		color: var(--accent);
	}

	.agent-input {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		padding: 0.375rem 0.5rem;
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text);
		outline: none;
		width: 100%;
	}

	.agent-input:focus {
		border-color: var(--accent);
	}

	.agent-input::placeholder {
		color: var(--text-muted);
	}

	.agent-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		background: var(--accent);
		color: var(--bg);
		border: none;
		border-radius: 0.375rem;
		padding: 0.375rem 0.75rem;
		font-size: 10px;
		font-family: var(--font-mono);
		font-weight: 600;
		cursor: pointer;
		transition: opacity 150ms ease;
	}

	.agent-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.agent-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
