<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { roomName, onlineCount }: { roomName: string; onlineCount: number } = $props();
</script>

<header
	class="sticky top-0 z-10 flex items-center justify-between px-4 py-3"
	style="background: var(--bg-elevated); border-bottom: 1px solid var(--border);"
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
	<div class="flex items-center gap-1.5">
		<span
			class="inline-block h-2 w-2 rounded-full"
			style="background: var(--success);"
		></span>
		<span class="text-xs" style="color: var(--text-muted);">
			{m.chat_online({ count: String(onlineCount) })}
		</span>
	</div>
</header>
