<script lang="ts">
	import type { SvelteMap } from 'svelte/reactivity';

	let {
		onlineUsers,
		userId,
		onMention
	}: {
		onlineUsers: SvelteMap<string, { name: string; role: string }>;
		userId: string;
		onMention: (name: string) => void;
	} = $props();

	const ROLE_COLORS: Record<string, string> = {
		owner: 'var(--warning)',
		lead: 'var(--accent)',
		agent: 'var(--info)',
		member: 'var(--text-muted)',
		viewer: 'var(--text-muted)'
	};

	const others = $derived(
		[...onlineUsers.entries()]
			.filter(([id]) => id !== userId)
			.map(([id, { name, role }]) => ({ id, name, role }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
</script>

{#if others.length > 0}
	<div
		class="scrollbar-none flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-1.5"
		style="background: var(--bg-elevated); border-bottom: 1px solid var(--border);"
		aria-label="Online members"
	>
		{#each others as member (member.id)}
			<button
				class="online-pill flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 transition-opacity hover:opacity-80 active:scale-95"
				style="background: var(--bg-surface); border: 1px solid var(--border);"
				onclick={() => onMention(member.name)}
				title="Mention {member.name}"
				data-testid="online-pill"
			>
				<span
					class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
					style="background: var(--success);"
					aria-hidden="true"
				></span>
				<span class="text-[11px]" style="color: var(--text); font-family: var(--font-mono);">
					{member.name}
				</span>
				<span
					class="rounded px-1 py-px text-[8px] font-bold uppercase leading-none"
					style="background: color-mix(in oklch, {ROLE_COLORS[member.role] ?? 'var(--text-muted)'} 15%, transparent); color: {ROLE_COLORS[member.role] ?? 'var(--text-muted)'}; font-family: var(--font-mono);"
				>
					{member.role}
				</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.scrollbar-none {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}

	.scrollbar-none::-webkit-scrollbar {
		display: none;
	}
</style>
