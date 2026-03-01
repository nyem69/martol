<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { X, ChevronDown, Check, Copy, ExternalLink, KeyRound, Trash2, Loader, LogOut } from '@lucide/svelte';
	import { getAvailableCommands } from '$lib/chat/commands';
	import { themeStore, THEMES } from '$lib/stores/theme.svelte';
	import { signOut } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import type { SvelteMap } from 'svelte/reactivity';

	let {
		open = false,
		onClose,
		onlineUsers,
		userRole = 'member',
		roomId = ''
	}: {
		open: boolean;
		onClose: () => void;
		onlineUsers: SvelteMap<string, string>;
		userRole?: string;
		roomId?: string;
	} = $props();

	// Collapsible section state — members open by default, rest collapsed
	let sectionsOpen = $state<Record<string, boolean>>({
		members: true,
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
	let registeredAgents = $state<Array<{id: number, label: string, model: string, keyStart: string | null, createdAt: string | null}>>([]);
	let newLabel = $state('');
	let newModel = $state('claude-sonnet-4-20250514');
	let generatedKey = $state<string | null>(null);
	let agentLoading = $state(false);
	let agentError = $state('');
	let agentsFetched = $state(false);

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
				body: JSON.stringify({ label: newLabel, model: newModel })
			});
			const data: { ok?: boolean; data?: { key?: string }; message?: string; error?: string } = await res.json();
			if (!res.ok || !data.ok) {
				agentError = data.message || data.error || 'Failed to create agent';
				return;
			}
			generatedKey = data.data?.key ?? null;
			newLabel = '';
			await fetchAgents();
		} catch {
			agentError = 'Network error';
		} finally {
			agentLoading = false;
		}
	}

	async function revokeAgent(id: number) {
		if (!confirm(m.agent_revoke_confirm())) return;
		try {
			const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
			const data: { ok?: boolean } = await res.json();
			if (data.ok) {
				registeredAgents = registeredAgents.filter((a) => a.id !== id);
			}
		} catch { /* silent */ }
	}

	// Fetch agents when agentSetup section opens
	$effect(() => {
		if (sectionsOpen.agentSetup && !agentsFetched) {
			fetchAgents();
		}
	});

	// Temporary heuristic: agents have labels with colons (e.g., "claude:backend").
	const agents = $derived(
		[...onlineUsers.entries()]
			.filter(([_, name]) => name.includes(':'))
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	const humans = $derived(
		[...onlineUsers.entries()]
			.filter(([_, name]) => !name.includes(':'))
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	let loggingOut = $state(false);

	async function handleLogout() {
		loggingOut = true;
		try {
			await signOut();
			goto('/login');
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
	class="fixed top-0 right-0 z-40 flex h-full w-72 flex-col border-l transition-transform duration-200"
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
						<div>
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
						<!-- Step 1: Clone -->
						<div class="mb-2">
							<h4 class="mb-1 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								1. Clone
							</h4>
							<div class="code-block">
								<div class="flex items-center justify-between">
									<code>git clone https://github.com/nyem69/martol-client.git</code>
									<button
										class="copy-btn"
										onclick={() => copyToClipboard('git clone https://github.com/nyem69/martol-client.git && cd martol-client', 'clone')}
										aria-label="Copy"
									>
										{#if copiedField === 'clone'}
											<Check size={10} />
										{:else}
											<Copy size={10} />
										{/if}
									</button>
								</div>
							</div>
						</div>

						<!-- Step 2: Install -->
						<div class="mb-2">
							<h4 class="mb-1 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								2. {m.agent_setup_install()}
							</h4>
							<div class="code-block">
								<div class="flex items-center justify-between">
									<code>pip install -r requirements.txt</code>
									<button
										class="copy-btn"
										onclick={() => copyToClipboard('pip install -r requirements.txt', 'install')}
										aria-label="Copy"
									>
										{#if copiedField === 'install'}
											<Check size={10} />
										{:else}
											<Copy size={10} />
										{/if}
									</button>
								</div>
							</div>
						</div>

						<!-- Step 3: Configure -->
						<div class="mb-2">
							<h4 class="mb-1 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								3. {m.agent_setup_configure()}
							</h4>
							<div class="code-block">
								<code>cp .env.example .env</code>
							</div>
						</div>

						<!-- Step 4: Run -->
						<div class="mb-3">
							<h4 class="mb-1 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								4. {m.agent_setup_run()}
							</h4>
							<div class="code-block">
								<div class="flex items-center justify-between">
									<code>python -m martol_agent</code>
									<button
										class="copy-btn"
										onclick={() => copyToClipboard('python -m martol_agent', 'run')}
										aria-label="Copy"
									>
										{#if copiedField === 'run'}
											<Check size={10} />
										{:else}
											<Copy size={10} />
										{/if}
									</button>
								</div>
							</div>
						</div>

						<!-- Parameters reference -->
						<div class="mb-3">
							<h4 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
								{m.agent_setup_params()}
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
								<div class="param-desc">{m.agent_setup_ws_url()}</div>
							</div>

							<!-- MCP URL -->
							<div class="param-row">
								<div class="flex items-center justify-between">
									<code class="param-label">MARTOL_MCP_URL</code>
									<button
										class="copy-btn"
										onclick={() => copyToClipboard(mcpUrl, 'mcp')}
										aria-label="Copy"
									>
										{#if copiedField === 'mcp'}
											<Check size={10} />
										{:else}
											<Copy size={10} />
										{/if}
									</button>
								</div>
								<div class="param-value">{mcpUrl}</div>
								<div class="param-desc">MCP HTTP endpoint</div>
							</div>

							<!-- API Key -->
							<div class="param-row">
								<code class="param-label">MARTOL_API_KEY</code>
								<div class="param-desc">{m.agent_setup_api_key()}</div>
							</div>

							<!-- Provider -->
							<div class="param-row">
								<code class="param-label">AI_PROVIDER</code>
								<div class="param-desc">{m.agent_setup_provider()}</div>
							</div>

							<!-- AI Key -->
							<div class="param-row">
								<code class="param-label">AI_API_KEY</code>
								<div class="param-desc">{m.agent_setup_ai_key()}</div>
							</div>

							<!-- Model -->
							<div class="param-row">
								<code class="param-label">AI_MODEL</code>
								<div class="param-desc">{m.agent_setup_model()}</div>
							</div>

							<!-- Label -->
							<div class="param-row">
								<code class="param-label">AGENT_LABEL</code>
								<div class="param-desc">{m.agent_setup_label()}</div>
							</div>
						</div>

						<!-- ── Generate Agent Key (owner/lead only) ── -->
						{#if canManageAgents}
							<div class="mb-3" style="border-top: 1px solid var(--border); padding-top: 0.75rem;">
								<h4 class="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent-muted);">
									<KeyRound size={11} />
									{m.agent_generate_title()}
								</h4>

								<div class="mb-2 flex flex-col gap-1.5">
									<input
										type="text"
										bind:value={newLabel}
										placeholder={m.agent_label_placeholder()}
										class="agent-input"
										data-testid="agent-label-input"
									/>
									<input
										type="text"
										bind:value={newModel}
										placeholder={m.agent_model_placeholder()}
										class="agent-input"
										data-testid="agent-model-input"
									/>
									<button
										class="agent-btn"
										onclick={createAgent}
										disabled={agentLoading || !newLabel.trim()}
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
									<div class="mb-2 rounded px-2 py-1 text-[10px]" style="background: color-mix(in oklch, var(--error) 15%, transparent); color: var(--error);">
										{agentError}
									</div>
								{/if}

								{#if generatedKey}
									<div class="mb-2 rounded p-2" style="background: color-mix(in oklch, var(--success) 10%, transparent); border: 1px solid color-mix(in oklch, var(--success) 30%, transparent);">
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
									{#each registeredAgents as agent (agent.id)}
										<div class="rounded p-1.5" style="background: var(--bg); border: 1px solid var(--border);">
											<div class="flex items-center justify-between">
												<span class="text-[11px] font-semibold" style="color: var(--text); font-family: var(--font-mono);">
													{agent.label}
												</span>
												{#if canManageAgents}
													<button
														class="rounded p-0.5 transition-colors hover:opacity-80"
														style="color: var(--error);"
														onclick={() => revokeAgent(agent.id)}
														aria-label={m.agent_revoke()}
														data-testid="agent-revoke-btn"
													>
														<Trash2 size={11} />
													</button>
												{/if}
											</div>
											<div class="text-[9px]" style="color: var(--text-muted);">
												{agent.model}
											</div>
											{#if agent.keyStart}
												<div class="text-[9px]" style="color: var(--text-muted); font-family: var(--font-mono);">
													{m.agent_key_prefix()}: {agent.keyStart}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Repo link -->
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
			style="background: color-mix(in oklch, var(--error) 12%, transparent); color: var(--error); font-family: var(--font-mono);"
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

<style>
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

	.param-desc {
		font-size: 10px;
		color: var(--text-muted);
	}

	.code-block {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		padding: 0.375rem 0.5rem;
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text);
		word-break: break-all;
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
