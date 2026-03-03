<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { SlashCommand } from '$lib/chat/commands';

	let {
		commands,
		selectedIndex = 0,
		onSelect
	}: {
		commands: SlashCommand[];
		selectedIndex: number;
		onSelect: (command: SlashCommand) => void;
	} = $props();

	// Description keys map to i18n message functions
	const descriptionMap: Record<string, () => string> = {
		chat_slash_approve: () => m.chat_slash_approve(),
		chat_slash_reject: () => m.chat_slash_reject(),
		chat_slash_actions: () => m.chat_slash_actions(),
		chat_slash_clear: () => m.chat_slash_clear(),
		chat_slash_continue: () => m.chat_slash_continue(),
		chat_slash_whois: () => m.chat_slash_whois()
	};

	function getDescription(key: string): string {
		return descriptionMap[key]?.() ?? key;
	}
</script>

{#if commands.length > 0}
	<div
		class="absolute bottom-full left-0 right-0 mb-1 overflow-y-auto rounded-lg shadow-lg"
		style="background: var(--bg-elevated); border: 1px solid var(--border); max-height: 40vh; scrollbar-width: thin; scrollbar-color: var(--border) transparent;"
		role="listbox"
		aria-label={m.chat_slash_commands()}
		data-testid="slash-menu"
	>
		{#each commands as cmd, i (cmd.name)}
			<button
				class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors"
				style="background: {i === selectedIndex
					? 'var(--bg-surface)'
					: 'transparent'}; color: var(--text);"
				role="option"
				aria-selected={i === selectedIndex}
				onclick={() => onSelect(cmd)}
				onmouseenter={() => (selectedIndex = i)}
			>
				<span style="color: var(--accent); font-family: var(--font-mono);">
					/{cmd.name}
				</span>
				{#if cmd.argPlaceholder}
					<span class="text-xs" style="color: var(--text-muted);">
						{cmd.argPlaceholder}
					</span>
				{/if}
				<span class="ml-auto text-xs" style="color: var(--text-muted);">
					{getDescription(cmd.description)}
				</span>
			</button>
		{/each}
	</div>
{:else}
	<div
		class="absolute bottom-full left-0 right-0 mb-1 rounded-lg px-3 py-2 text-xs shadow-lg"
		style="background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-muted);"
	>
		{m.chat_slash_no_results()}
	</div>
{/if}
