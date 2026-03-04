<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
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

	const hasSim = $derived(!!action.simulationType && !!action.simulationPayload);
	let expanded = $state(false);

	// Auto-expand pending actions with simulation data
	$effect(() => {
		if (action.status === 'pending' && hasSim) {
			expanded = true;
		}
	});

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

	function severityColor(severity: string): string {
		return severity === 'high' ? 'var(--danger)' : severity === 'medium' ? 'var(--warning)' : 'var(--text-muted)';
	}
</script>

<div
	class="mx-4 my-3 rounded-lg px-3 py-2"
	style="background: var(--bg-surface); border: 1px solid {riskColor}; border-left-width: 3px;"
	role="group"
	aria-label="{action.riskLevel} risk action: {action.actionType.replace(/_/g, ' ')}"
>
	<!-- Header row -->
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
		{#if hasSim}
			<button
				class="ml-auto flex items-center gap-1 text-[11px]"
				style="color: var(--text-muted); font-family: var(--font-mono);"
				onclick={() => (expanded = !expanded)}
				aria-expanded={expanded}
				aria-label={expanded ? m.action_simulation_collapse() : m.action_simulation_expand()}
			>
				{expanded ? m.action_simulation_collapse() : m.action_simulation_expand()}
				{#if expanded}
					<ChevronUp size={12} />
				{:else}
					<ChevronDown size={12} />
				{/if}
			</button>
		{/if}
	</div>

	<!-- Description -->
	<p class="text-sm" style="color: var(--text);">
		{action.description}
	</p>

	<!-- Simulation preview -->
	{#if expanded && hasSim}
		<div class="mt-2">
			<!-- Code diff -->
			{#if action.simulationType === 'code_diff'}
				{@const preview = action.simulationPayload as { file?: string; diff?: string; lines_added?: number; lines_removed?: number }}
				<div class="sim-block">
					<div class="sim-file-header">
						<span>{preview.file ?? 'unknown'}</span>
						<span class="flex gap-2">
							{#if preview.lines_removed}<span style="color: var(--danger);">-{preview.lines_removed}</span>{/if}
							{#if preview.lines_added}<span style="color: var(--success);">+{preview.lines_added}</span>{/if}
						</span>
					</div>
					<pre class="sim-diff">{#each (preview.diff ?? '').split('\n') as line}{@const cls = line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : 'diff-ctx'}<span class={cls}>{line}</span>
{/each}</pre>
				</div>

			<!-- Shell preview -->
			{:else if action.simulationType === 'shell_preview'}
				{@const preview = action.simulationPayload as { command?: string; working_dir?: string; predicted_effects?: string[] }}
				<div class="sim-block">
					<div class="sim-file-header">
						<span>{m.action_simulation_shell_command()}</span>
						{#if preview.working_dir}
							<span>{preview.working_dir}</span>
						{/if}
					</div>
					<pre class="sim-shell">$ {preview.command ?? ''}</pre>
					{#if preview.predicted_effects?.length}
						<div class="sim-effects-header">{m.action_simulation_shell_effects()}</div>
						<ul class="sim-effects">
							{#each preview.predicted_effects as effect}
								<li>{effect}</li>
							{/each}
						</ul>
					{/if}
				</div>

			<!-- API call -->
			{:else if action.simulationType === 'api_call'}
				{@const preview = action.simulationPayload as { method?: string; url?: string; headers?: Record<string, string>; body?: string }}
				<div class="sim-block">
					<div class="sim-file-header">
						<span><strong>{preview.method ?? 'GET'}</strong> {preview.url ?? ''}</span>
					</div>
					{#if preview.body}
						<pre class="sim-body">{preview.body}</pre>
					{/if}
				</div>

			<!-- File operations -->
			{:else if action.simulationType === 'file_ops'}
				{@const preview = action.simulationPayload as { operations?: { path: string; op: string }[] }}
				<div class="sim-block">
					<div class="sim-file-header">
						<span>{m.action_simulation_file_ops()}</span>
					</div>
					<div class="sim-file-list">
						{#each preview.operations ?? [] as op}
							<div class="sim-file-op">
								<span style="color: {op.op === 'create' ? 'var(--success)' : op.op === 'delete' ? 'var(--danger)' : 'var(--warning)'}; font-family: var(--font-mono); font-size: 11px; min-width: 48px;">
									{op.op}
								</span>
								<span style="font-family: var(--font-mono); font-size: 12px; color: var(--text);">{op.path}</span>
							</div>
						{/each}
					</div>
				</div>

			<!-- Custom markdown -->
			{:else if action.simulationType === 'custom'}
				{@const preview = action.simulationPayload as { markdown?: string }}
				<div class="sim-block">
					<pre class="sim-custom">{preview.markdown ?? ''}</pre>
				</div>
			{/if}

			<!-- Impact summary -->
			{#if action.estimatedImpact}
				<div class="mt-1.5 flex flex-wrap gap-1 text-[11px]" style="font-family: var(--font-mono); color: var(--text-muted);">
					{#if action.estimatedImpact.files_modified != null}
						<span>{m.action_simulation_impact({ count: String(action.estimatedImpact.files_modified) })}</span>
					{/if}
					{#if action.estimatedImpact.services_affected?.length}
						<span>· {action.estimatedImpact.services_affected.join(', ')}</span>
					{/if}
					{#if action.estimatedImpact.reversible != null}
						<span style="color: {action.estimatedImpact.reversible ? 'var(--text-muted)' : 'var(--danger)'};">
							· {action.estimatedImpact.reversible ? m.action_simulation_reversible() : m.action_simulation_irreversible()}
						</span>
					{/if}
				</div>
			{/if}

			<!-- Risk factors -->
			{#if action.riskFactors?.length}
				<div class="mt-1">
					{#each action.riskFactors as rf}
						<div class="flex gap-1.5 text-[11px] leading-relaxed">
							<span style="color: {severityColor(rf.severity)}; font-family: var(--font-mono); font-weight: 500;">
								{rf.factor}
							</span>
							<span style="color: var(--text-muted);">
								{rf.detail}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Action buttons -->
	<div class="mt-2 flex items-center gap-2">
		{#if action.status === 'pending' && canApprove}
			<button
				class="flex items-center justify-center min-h-[44px] min-w-[44px] rounded px-3 py-2.5 text-xs font-medium transition-opacity hover:opacity-80 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
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
				class="flex items-center justify-center min-h-[44px] min-w-[44px] rounded px-3 py-2.5 text-xs font-medium transition-opacity hover:opacity-80 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
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

<style>
	.sim-block {
		border: 1px solid var(--border);
		border-radius: 4px;
		overflow: hidden;
	}

	.sim-file-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 5px 10px;
		background: var(--bg-elevated);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border);
	}

	.sim-diff {
		margin: 0;
		padding: 6px 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		overflow-x: auto;
		white-space: pre;
		background: var(--bg);
	}

	.sim-diff :global(.diff-add) {
		display: block;
		color: var(--success);
		background: color-mix(in oklch, var(--success) 10%, transparent);
	}

	.sim-diff :global(.diff-del) {
		display: block;
		color: var(--danger);
		background: color-mix(in oklch, var(--danger) 10%, transparent);
	}

	.sim-diff :global(.diff-ctx) {
		display: block;
		color: var(--text-muted);
	}

	.sim-shell {
		margin: 0;
		padding: 6px 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text);
		background: var(--bg);
		white-space: pre-wrap;
		word-break: break-all;
	}

	.sim-effects-header {
		padding: 4px 10px 0;
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--text-muted);
	}

	.sim-effects {
		margin: 0;
		padding: 2px 10px 6px 24px;
		font-size: 12px;
		color: var(--text-muted);
		list-style: disc;
	}

	.sim-effects li {
		padding: 1px 0;
	}

	.sim-body {
		margin: 0;
		padding: 6px 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		overflow-x: auto;
		white-space: pre;
		background: var(--bg);
		color: var(--text);
	}

	.sim-file-list {
		padding: 4px 0;
	}

	.sim-file-op {
		display: flex;
		gap: 8px;
		padding: 2px 10px;
	}

	.sim-custom {
		margin: 0;
		padding: 6px 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: pre-wrap;
		background: var(--bg);
		color: var(--text);
	}
</style>
