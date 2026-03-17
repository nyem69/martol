<script lang="ts">
	import type { ToolCallGroup } from '$lib/types/timeline';
	import { renderMarkdown } from '$lib/utils/markdown';
	import * as m from '$lib/paraglide/messages';
	import { ChevronRight, ChevronDown, Wrench, CircleCheck, CircleX, Loader } from '@lucide/svelte';

	let { group }: { group: ToolCallGroup } = $props();

	let expanded = $state(false);
	let expandedRows = $state(new Set<string>());

	// Auto-collapse 1s after streaming ends
	let wasStreaming = $state(false);
	$effect(() => {
		if (group.isStreaming) {
			wasStreaming = true;
			expanded = true;
		} else if (wasStreaming) {
			wasStreaming = false;
			const timer = setTimeout(() => { expanded = false; }, 1000);
			return () => clearTimeout(timer);
		}
	});

	function toggleRow(localId: string) {
		if (expandedRows.has(localId)) {
			expandedRows.delete(localId);
		} else {
			expandedRows.add(localId);
		}
		// Trigger reactivity
		expandedRows = new Set(expandedRows);
	}

	const summaryText = $derived(
		group.isStreaming
			? m.tool_calls_running({ count: group.messages.length })
			: m.tool_calls_used({ count: group.messages.length })
	);
</script>

<div class="tool-group px-4 py-1" data-testid="tool-call-group">
	<!-- Agent name row -->
	<div class="mb-0.5 flex items-center gap-1.5">
		<span class="text-[11px] font-medium" style="color: var(--accent);">
			{group.agentName}
		</span>
		<span
			class="rounded px-1 text-[9px] uppercase"
			style="background: var(--bg-elevated); color: var(--text-muted); font-family: var(--font-mono);"
		>
			{group.agentRole}
		</span>
	</div>

	<!-- Collapsed pill -->
	<button
		class="tool-pill flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors"
		style="background: var(--bg-surface); border: 1px solid var(--border-subtle); color: var(--text-muted); font-family: var(--font-mono);"
		onclick={() => (expanded = !expanded)}
		aria-expanded={expanded}
		data-testid="tool-group-toggle"
	>
		{#if expanded}
			<ChevronDown size={12} />
		{:else}
			<ChevronRight size={12} />
		{/if}
		<Wrench size={11} />
		<span>{summaryText}</span>
	</button>

	<!-- Expanded detail -->
	{#if expanded}
		<div class="mt-1 ml-3 flex flex-col gap-0.5" data-testid="tool-group-detail">
			{#each group.messages as tcMsg (tcMsg.localId)}
				<div class="tool-row rounded px-2 py-1" style="background: var(--bg-elevated);">
					<button
						class="flex w-full items-center gap-1.5 text-left text-[11px]"
						style="font-family: var(--font-mono);"
						onclick={() => toggleRow(tcMsg.localId)}
					>
						<!-- Status icon -->
						{#if tcMsg.status === 'running'}
							<span class="animate-spin" style="color: var(--accent);">
								<Loader size={11} />
							</span>
						{:else if tcMsg.status === 'error'}
							<CircleX size={11} style="color: var(--danger);" />
						{:else}
							<CircleCheck size={11} style="color: var(--text-muted);" />
						{/if}

						<!-- Tool name badge -->
						<span
							class="rounded px-1 py-0.5 text-[10px]"
							style="background: color-mix(in oklch, var(--accent) 12%, transparent); color: var(--accent);"
						>
							{tcMsg.toolName}
						</span>

						<!-- Input summary -->
						{#if tcMsg.inputSummary}
							<span class="truncate" style="color: var(--text-muted);">
								{tcMsg.inputSummary}
							</span>
						{/if}
					</button>

					<!-- Expanded output -->
					{#if expandedRows.has(tcMsg.localId)}
						<article
							class="prose mt-1 border-t pt-1 text-xs"
							style="color: var(--text); border-color: var(--border-subtle);"
						>
							{@html renderMarkdown(tcMsg.resultBody)}
						</article>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.tool-pill:hover {
		background: var(--bg-elevated) !important;
	}
</style>
