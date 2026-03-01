<script lang="ts">
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { X, UserPen } from '@lucide/svelte';

	let {
		username
	}: {
		username: string;
	} = $props();

	const DISMISS_KEY = 'username-prompt-dismissed';

	let dismissed = $state(false);

	// Check localStorage on mount
	$effect(() => {
		if (typeof window !== 'undefined') {
			dismissed = localStorage.getItem(DISMISS_KEY) === 'true';
		}
	});

	const shouldShow = $derived(
		!dismissed && username.startsWith('user-')
	);

	function dismiss() {
		dismissed = true;
		if (typeof window !== 'undefined') {
			localStorage.setItem(DISMISS_KEY, 'true');
		}
	}
</script>

{#if shouldShow}
	<div
		class="flex shrink-0 items-center gap-2 px-4 py-2"
		style="background: color-mix(in oklch, var(--accent) 8%, var(--bg-surface)); border-bottom: 1px solid var(--border);"
		role="banner"
	>
		<UserPen size={14} style="color: var(--accent); flex-shrink: 0;" />
		<span class="flex-1 text-xs" style="color: var(--text-muted);">
			{m.username_personalize()}
		</span>
		<button
			onclick={() => goto('/settings')}
			class="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
			style="background: var(--accent); color: var(--bg); font-family: var(--font-mono);"
			data-testid="username-prompt-cta"
		>
			{m.username_personalize_cta()}
		</button>
		<button
			onclick={dismiss}
			class="shrink-0 rounded p-0.5 transition-opacity hover:opacity-70"
			style="color: var(--text-muted);"
			aria-label={m.chat_dismiss()}
			data-testid="username-prompt-dismiss"
		>
			<X size={14} />
		</button>
	</div>
{/if}
