<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { goto } from '$app/navigation';
	import { Check, Copy, AlertTriangle, Loader } from '@lucide/svelte';

	let { data } = $props();
	let copied = $state(false);
	let copiedCli = $state(false);
	let copiedMcp = $state(false);

	async function copyText(text: string, setter: (v: boolean) => void) {
		try {
			await navigator.clipboard.writeText(text);
			setter(true);
			setTimeout(() => setter(false), 2000);
		} catch {
			// Fallback: select text for manual copy
			const el = document.activeElement as HTMLElement | null;
			const pre = el?.closest('.snippet-wrap')?.querySelector('pre, code');
			if (pre) {
				const range = document.createRange();
				range.selectNode(pre);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(range);
			}
		}
	}

	function copyKey() {
		if ('agentKey' in data && data.agentKey) {
			copyText(data.agentKey, (v) => (copied = v));
		}
	}

	function cliSnippet() {
		if (!('agentKey' in data)) return '';
		return `martol-client --key ${data.agentKey} --mcp-url https://martol.plitix.com/mcp/v1`;
	}

	function mcpSnippet() {
		if (!('agentKey' in data)) return '';
		return JSON.stringify({
			mcpServers: {
				martol: {
					url: 'https://martol.plitix.com/mcp/v1',
					headers: { 'x-api-key': data.agentKey }
				}
			}
		}, null, 2);
	}
</script>

<svelte:head>
	<title>{m.open_title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center px-4" style="background: var(--bg);">
	<div
		class="w-full max-w-lg"
		style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem;"
	>
		<!-- Header -->
		<div class="mb-6 text-center">
			<h1
				class="text-2xl font-bold tracking-widest"
				style="color: var(--accent); font-family: var(--font-mono);"
			>
				MARTOL
			</h1>
			<p class="mt-1 text-xs" style="color: var(--text-muted);">
				{m.open_subtitle()}
			</p>
		</div>

		{#if 'error' in data && data.error === 'invalid_repo'}
			<!-- Invalid repo format -->
			<div
				class="mb-6 flex items-center gap-3 rounded-lg p-4"
				style="background: color-mix(in oklch, var(--text-muted) 10%, transparent); border: 1px solid var(--border);"
			>
				<AlertTriangle size={18} style="color: var(--accent); flex-shrink: 0;" />
				<p class="text-sm" style="color: var(--text-muted);">
					{m.open_invalid_repo()}
				</p>
			</div>
			<a
				href="/chat"
				class="flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-xs transition-opacity hover:opacity-80"
				style="color: var(--text-muted); border: 1px solid var(--border); text-decoration: none; font-family: var(--font-mono);"
			>
				{m.open_go_to_chat()}
			</a>
		{:else if 'agentKey' in data}
			<!-- Room created successfully -->
			<div
				class="mb-4 rounded-lg p-4"
				style="background: var(--bg); border: 1px solid var(--border);"
			>
				<p
					class="text-[10px] font-bold uppercase tracking-wider"
					style="color: var(--text-muted); font-family: var(--font-mono);"
				>
					{m.open_room_created()}
				</p>
				<p
					class="mt-2 text-lg font-bold"
					style="color: var(--accent); font-family: var(--font-mono);"
				>
					{data.repo}
				</p>
				<p
					class="mt-1 text-[10px]"
					style="color: var(--text-muted); font-family: var(--font-mono);"
				>
					Room ID: {data.roomId}
				</p>
			</div>

			<!-- API Key -->
			<div
				class="mb-4 rounded-lg p-4"
				style="background: var(--bg); border: 1px solid color-mix(in oklch, var(--accent) 40%, var(--border));"
			>
				<div class="mb-2 flex items-center gap-2">
					<AlertTriangle size={14} style="color: var(--accent);" />
					<p class="text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent);">
						{m.open_key_warning()}
					</p>
				</div>
				<div class="snippet-wrap flex items-center gap-2">
					<code
						class="flex-1 overflow-x-auto rounded px-3 py-2 text-xs"
						style="background: var(--bg-surface); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						data-testid="agent-key"
					>
						{data.agentKey}
					</code>
					<button
						type="button"
						onclick={copyKey}
						class="flex items-center gap-1 rounded px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
						style="background: var(--accent); color: var(--bg); font-family: var(--font-mono);"
						aria-label={copied ? m.open_copied() : m.open_copy_key()}
						data-testid="copy-key-btn"
					>
						{#if copied}
							<Check size={12} />
							<span aria-live="polite">{m.open_copied()}</span>
						{:else}
							<Copy size={12} />
							{m.open_copy_key()}
						{/if}
					</button>
				</div>
			</div>

			<!-- CLI snippet -->
			<div
				class="snippet-wrap mb-4 rounded-lg p-4"
				style="background: var(--bg); border: 1px solid var(--border);"
			>
				<div class="mb-2 flex items-center justify-between">
					<p
						class="text-[10px] font-bold uppercase tracking-wider"
						style="color: var(--text-muted); font-family: var(--font-mono);"
					>
						{m.open_cli_title()}
					</p>
					<button
						type="button"
						onclick={() => copyText(cliSnippet(), (v) => (copiedCli = v))}
						class="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold transition-opacity hover:opacity-80"
						style="color: var(--text-muted); border: 1px solid var(--border);"
						aria-label={copiedCli ? m.open_copied() : 'Copy CLI command'}
						data-testid="copy-cli-btn"
					>
						{#if copiedCli}
							<Check size={10} />
							<span aria-live="polite">{m.open_copied()}</span>
						{:else}
							<Copy size={10} />
							{m.open_copy_key()}
						{/if}
					</button>
				</div>
				<pre
					class="overflow-x-auto rounded p-3 text-xs leading-relaxed"
					style="background: var(--bg-surface); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
>{cliSnippet()}</pre>
			</div>

			<!-- MCP config snippet -->
			<div
				class="snippet-wrap mb-6 rounded-lg p-4"
				style="background: var(--bg); border: 1px solid var(--border);"
			>
				<div class="mb-2 flex items-center justify-between">
					<p
						class="text-[10px] font-bold uppercase tracking-wider"
						style="color: var(--text-muted); font-family: var(--font-mono);"
					>
						{m.open_mcp_title()}
					</p>
					<button
						type="button"
						onclick={() => copyText(mcpSnippet(), (v) => (copiedMcp = v))}
						class="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold transition-opacity hover:opacity-80"
						style="color: var(--text-muted); border: 1px solid var(--border);"
						aria-label={copiedMcp ? m.open_copied() : 'Copy MCP config'}
						data-testid="copy-mcp-btn"
					>
						{#if copiedMcp}
							<Check size={10} />
							<span aria-live="polite">{m.open_copied()}</span>
						{:else}
							<Copy size={10} />
							{m.open_copy_key()}
						{/if}
					</button>
				</div>
				<pre
					class="overflow-x-auto rounded p-3 text-xs leading-relaxed"
					style="background: var(--bg-surface); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
>{mcpSnippet()}</pre>
			</div>

			<!-- Go to chat -->
			<button
				type="button"
				onclick={() => goto('/chat')}
				class="flex w-full items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
				style="background: var(--accent); color: var(--bg); font-family: var(--font-mono);"
				data-testid="go-to-chat-btn"
			>
				{m.open_go_to_chat()}
			</button>
		{:else}
			<!-- Loading / unexpected state -->
			<div class="flex items-center justify-center gap-2 py-8">
				<Loader size={16} class="animate-spin" style="color: var(--text-muted);" />
				<p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">
					{m.open_creating()}
				</p>
			</div>
		{/if}
	</div>
</div>
