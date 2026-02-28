<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { MentionUser } from '$lib/types/chat';

	let {
		users,
		selectedIndex = 0,
		onSelect
	}: {
		users: MentionUser[];
		selectedIndex: number;
		onSelect: (user: MentionUser) => void;
	} = $props();
</script>

{#if users.length > 0}
	<div
		class="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-lg shadow-lg"
		style="background: var(--bg-elevated); border: 1px solid var(--border);"
		role="listbox"
		aria-label={m.chat_mention_users()}
		data-testid="mention-popup"
	>
		{#each users as user, i (user.id)}
			<button
				class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
				style="background: {i === selectedIndex
					? 'var(--bg-surface)'
					: 'transparent'}; color: var(--text);"
				role="option"
				aria-selected={i === selectedIndex}
				onclick={() => onSelect(user)}
				onmouseenter={() => (selectedIndex = i)}
			>
				<span style="color: var(--accent);">@</span>
				<span>{user.name}</span>
			</button>
		{/each}
	</div>
{:else}
	<div
		class="absolute bottom-full left-0 right-0 mb-1 rounded-lg px-3 py-2 text-xs shadow-lg"
		style="background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-muted);"
	>
		{m.chat_mention_no_results()}
	</div>
{/if}
