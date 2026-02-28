<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Menu } from '@lucide/svelte';

	let {
		roomName,
		onlineCount,
		onToggleMembers
	}: {
		roomName: string;
		onlineCount: number;
		onToggleMembers: () => void;
	} = $props();
</script>

<header
	class="z-10 flex shrink-0 items-center justify-between px-4 py-3"
	style="background: var(--bg-elevated); border-bottom: 1px solid var(--border); padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));"
>
	<div class="flex items-center gap-2">
		<span
			class="text-sm font-bold tracking-widest"
			style="color: var(--accent); font-family: var(--font-mono);"
		>
			MARTOL
		</span>
		<span class="text-xs" style="color: var(--text-muted);">/</span>
		<span class="text-sm font-medium" style="color: var(--text);">
			{roomName}
		</span>
	</div>
	<div class="flex items-center gap-3">
		{#if onlineCount > 0}
			<div class="flex items-center gap-1.5" aria-live="polite">
				<span
					class="inline-block h-2 w-2 rounded-full"
					style="background: var(--success);"
					aria-hidden="true"
				></span>
				<span class="text-xs" style="color: var(--text-muted);">
					{m.chat_online({ count: String(onlineCount) })}
				</span>
			</div>
		{/if}
		<button
			class="rounded p-1.5 transition-opacity hover:opacity-70 active:scale-95"
			style="color: var(--text-muted);"
			onclick={onToggleMembers}
			aria-label={m.chat_toggle_members()}
			data-testid="toggle-members"
		>
			<Menu size={18} />
		</button>
	</div>
</header>
