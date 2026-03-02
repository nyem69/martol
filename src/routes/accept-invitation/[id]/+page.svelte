<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Loader } from '@lucide/svelte';

	let { data } = $props();
	let accepting = $state(false);

	// svelte-ignore state_referenced_locally — intentional: invitation data is stable for page lifetime
	const canJoin = data.status === 'pending' && !data.expired && !data.invalid;
</script>

<svelte:head>
	<title>{m.invite_title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center px-4" style="background: var(--bg);">
	<div
		class="w-full max-w-sm"
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
				{m.invite_title()}
			</p>
		</div>

		<!-- Invitation details -->
		<div
			class="mb-6 rounded-lg p-4"
			style="background: var(--bg); border: 1px solid var(--border);"
		>
			<p class="text-sm" style="color: var(--text-muted);">
				{m.invite_body({ inviter: data.inviterName })}
			</p>
			<p
				class="mt-2 text-lg font-bold"
				style="color: var(--accent); font-family: var(--font-mono);"
			>
				{data.orgName}
			</p>
			<div class="mt-3 flex items-center gap-2">
				<span class="text-[10px] font-semibold uppercase tracking-wider" style="color: var(--text-muted);">
					{m.invite_role_label()}
				</span>
				<span
					class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase"
					style="background: color-mix(in oklch, var(--accent) 15%, transparent); color: var(--accent); font-family: var(--font-mono);"
				>
					{data.role}
				</span>
			</div>
		</div>

		{#if canJoin}
			<!-- About Martol -->
			<div class="mb-6 rounded-lg p-4" style="background: var(--bg); border: 1px solid var(--border);">
				<h3
					class="mb-1.5 text-[10px] font-bold uppercase tracking-wider"
					style="color: var(--text-muted); font-family: var(--font-mono);"
				>
					{m.invite_about_title()}
				</h3>
				<p class="text-xs leading-relaxed" style="color: var(--text-muted);">
					{m.invite_about_body()}
				</p>
				<div class="mt-3 flex flex-col gap-1">
					<a
						href="/legal/terms"
						target="_blank"
						class="text-[11px] underline transition-opacity hover:opacity-80"
						style="color: var(--accent);"
					>{m.legal_terms()}</a>
					<a
						href="/legal/privacy"
						target="_blank"
						class="text-[11px] underline transition-opacity hover:opacity-80"
						style="color: var(--accent);"
					>{m.legal_privacy()}</a>
				</div>
			</div>

			<!-- Actions -->
			<div class="flex flex-col gap-2">
				{#if data.loggedIn}
					<form method="POST" action="?/accept" onsubmit={() => (accepting = true)}>
						<button
							type="submit"
							class="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
							style="background: var(--accent); color: var(--bg); font-family: var(--font-mono);"
							disabled={accepting}
							data-testid="accept-invite-btn"
						>
							{#if accepting}
								<Loader size={14} class="animate-spin" />
								{m.invite_accepting()}
							{:else}
								{m.invite_accept()}
							{/if}
						</button>
					</form>

					<form method="POST" action="?/decline">
						<button
							type="submit"
							class="w-full rounded-lg px-4 py-2.5 text-xs transition-opacity hover:opacity-80"
							style="color: var(--text-muted); background: transparent; border: 1px solid var(--border); font-family: var(--font-mono);"
							disabled={accepting}
							data-testid="decline-invite-btn"
						>
							{m.invite_decline()}
						</button>
					</form>
				{:else}
					<a
						href="/login?redirect=/accept-invitation/{data.invitationId}"
						class="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
						style="background: var(--accent); color: var(--bg); font-family: var(--font-mono); text-decoration: none;"
						data-testid="sign-in-to-join-btn"
					>
						{m.invite_sign_in_to_join()}
					</a>
				{/if}
			</div>
		{:else}
			<!-- Inactive invitation -->
			<div
				class="mb-6 rounded-lg p-4 text-center text-sm"
				style="background: color-mix(in oklch, var(--text-muted) 10%, transparent); color: var(--text-muted);"
			>
				{#if data.status === 'accepted'}
					{m.invite_already_accepted()}
				{:else if data.expired}
					{m.invite_expired()}
				{:else}
					{m.invite_invalid()}
				{/if}
			</div>

			<a
				href="/chat"
				class="flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-xs transition-opacity hover:opacity-80"
				style="color: var(--text-muted); border: 1px solid var(--border); text-decoration: none; font-family: var(--font-mono);"
			>
				{m.invite_go_to_chat()}
			</a>
		{/if}
	</div>
</div>
