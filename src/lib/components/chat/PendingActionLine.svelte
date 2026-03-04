<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { PendingAction } from '$lib/types/chat';

	let {
		action,
		canApprove = false,
		loading = false,
		onApprove,
		onReject
	}: {
		action: PendingAction;
		canApprove?: boolean;
		loading?: boolean;
		onApprove?: (id: number) => void;
		onReject?: (id: number) => void;
	} = $props();

	const riskColor = $derived(
		action.riskLevel === 'high'
			? 'var(--danger)'
			: action.riskLevel === 'medium'
				? 'var(--warning)'
				: 'var(--text-muted)'
	);

	const statusColor = $derived(
		action.status === 'approved'
			? 'var(--success)'
			: action.status === 'rejected'
				? 'var(--danger)'
				: action.status === 'expired'
					? 'var(--text-muted)'
					: 'var(--warning)'
	);
</script>

<div
	class="mx-4 my-3 rounded-lg px-3 py-2"
	style="background: var(--bg-surface); border: 1px solid {riskColor}; border-left-width: 3px;"
	role="group"
	aria-label="{action.riskLevel} risk action: {action.actionType.replace(/_/g, ' ')}"
>
	<div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
		<span class="font-medium uppercase" style="color: {riskColor}; font-family: var(--font-mono);">
			{action.riskLevel}
		</span>
		<span style="color: var(--text-muted);">
			{action.actionType.replace(/_/g, ' ')}
		</span>
		<span style="color: var(--text-muted);">
			{m.chat_action_by({ name: action.requestedBy, role: action.requestedRole })}
		</span>
		<span style="color: var(--text-muted);">
			{m.chat_action_via({ agent: action.agentName })}
		</span>
	</div>
	<p class="text-sm" style="color: var(--text);">
		{action.description}
	</p>
	<div class="mt-2 flex items-center gap-2">
		{#if action.status === 'pending' && canApprove}
			<button
				class="min-h-[44px] min-w-[72px] rounded px-3 py-2.5 text-xs font-medium transition-opacity hover:opacity-80 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
				style="background: var(--success); color: var(--bg);"
				onclick={() => onApprove?.(action.id)}
				disabled={loading}
				aria-busy={loading}
				data-testid="approve-action-{action.id}"
			>
				{#if loading}
					<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
				{:else}
					{m.action_approve()}
				{/if}
			</button>
			<button
				class="min-h-[44px] min-w-[72px] rounded px-3 py-2.5 text-xs font-medium transition-opacity hover:opacity-80 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
				style="background: var(--danger); color: var(--bg);"
				onclick={() => onReject?.(action.id)}
				disabled={loading}
				aria-busy={loading}
				data-testid="reject-action-{action.id}"
			>
				{#if loading}
					<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
				{:else}
					{m.action_reject()}
				{/if}
			</button>
		{:else if action.status !== 'pending'}
			<span
				class="rounded px-2 py-0.5 text-[11px] font-medium uppercase"
				style="background: {statusColor}; color: var(--bg); font-family: var(--font-mono);"
			>
				{action.status}
			</span>
		{:else}
			<span class="text-[11px]" style="color: var(--text-muted);">
				{m.chat_action_awaiting()}
			</span>
		{/if}
	</div>
</div>
