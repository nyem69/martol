<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { PendingAction } from '$lib/types/chat';

	let {
		action,
		canApprove = false,
		onApprove,
		onReject
	}: {
		action: PendingAction;
		canApprove?: boolean;
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
	class="mx-4 my-1.5 rounded-lg px-3 py-2"
	style="background: var(--bg-surface); border: 1px solid {riskColor}; border-left-width: 3px;"
	role="alert"
>
	<div class="mb-1 flex items-center gap-2 text-xs">
		<span class="font-medium uppercase" style="color: {riskColor}; font-family: var(--font-mono);">
			{action.riskLevel}
		</span>
		<span style="color: var(--text-muted);">
			{action.actionType.replace('_', ' ')}
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
				class="rounded px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 active:scale-95"
				style="background: var(--success); color: var(--bg);"
				onclick={() => onApprove?.(action.id)}
				data-testid="approve-action-{action.id}"
			>
				{m.action_approve()}
			</button>
			<button
				class="rounded px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 active:scale-95"
				style="background: var(--danger); color: var(--bg);"
				onclick={() => onReject?.(action.id)}
				data-testid="reject-action-{action.id}"
			>
				{m.action_reject()}
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
