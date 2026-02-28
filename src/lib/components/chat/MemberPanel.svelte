<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { X, ChevronDown, Check } from '@lucide/svelte';
	import { getAvailableCommands } from '$lib/chat/commands';
	import { themeStore, THEMES } from '$lib/stores/theme.svelte';
	import type { SvelteMap } from 'svelte/reactivity';

	let {
		open = false,
		onClose,
		onlineUsers,
		userRole = 'member'
	}: {
		open: boolean;
		onClose: () => void;
		onlineUsers: SvelteMap<string, string>;
		userRole?: string;
	} = $props();

	// Collapsible section state — members open by default, rest collapsed
	let sectionsOpen = $state<Record<string, boolean>>({
		members: true,
		guide: false,
		theme: false
	});

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
</style>
