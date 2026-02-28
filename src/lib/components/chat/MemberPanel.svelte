<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { X } from '@lucide/svelte';
	import type { SvelteMap } from 'svelte/reactivity';

	let {
		open = false,
		onClose,
		onlineUsers
	}: {
		open: boolean;
		onClose: () => void;
		onlineUsers: SvelteMap<string, string>;
	} = $props();

	// Temporary heuristic: agents have labels with colons (e.g., "claude:backend").
	// TODO: extend presence data with isAgent flag from server for reliable detection.
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
	aria-label={m.chat_members_panel()}
>
	<!-- Header -->
	<div
		class="flex items-center justify-between px-4 py-3"
		style="border-bottom: 1px solid var(--border); padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));"
	>
		<span class="text-xs font-bold uppercase tracking-wider" style="color: var(--text-muted);">
			{m.chat_members()}
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

	<div class="flex-1 overflow-y-auto px-4 py-3">
		<!-- Agents section -->
		{#if agents.length > 0}
			<div class="mb-4">
				<h3
					class="mb-2 text-[11px] font-bold uppercase tracking-wider"
					style="color: var(--text-muted); font-family: var(--font-mono);"
				>
					{m.chat_agents()} — {agents.length}
				</h3>
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

		<!-- Users section -->
		<div>
			<h3
				class="mb-2 text-[11px] font-bold uppercase tracking-wider"
				style="color: var(--text-muted); font-family: var(--font-mono);"
			>
				{m.chat_users()} — {humans.length}
			</h3>
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
</aside>
