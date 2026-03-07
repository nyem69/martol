<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Shield } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();
</script>

<div class="admin-shell">
	<nav class="admin-nav">
		<div class="nav-brand">
			<Shield size={18} />
			<span>{m.admin_title()}</span>
		</div>
		<div class="nav-links">
			<a href="/admin" class="nav-link" data-testid="admin-nav-dashboard">{m.admin_dashboard()}</a>
			<a href="/admin/users" class="nav-link" data-testid="admin-nav-users">{m.admin_users()}</a>
			<a href="/admin/tickets" class="nav-link" data-testid="admin-nav-tickets">{m.admin_tickets()}</a>
		</div>
		<button class="nav-back" onclick={() => goto('/chat')} data-testid="admin-back">
			<ArrowLeft size={16} />
			{m.settings_back()}
		</button>
	</nav>
	<main class="admin-content">
		{@render children()}
	</main>
</div>

<style>
	.admin-shell {
		min-height: 100dvh;
		background: var(--bg);
		color: var(--fg);
	}

	.admin-nav {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}

	.nav-brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
		color: var(--accent);
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.nav-links {
		display: flex;
		gap: 0.25rem;
		flex: 1;
	}

	.nav-link {
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		font-size: 0.85rem;
		color: var(--fg-muted);
		text-decoration: none;
		transition: background 0.15s, color 0.15s;
	}

	.nav-link:hover {
		background: var(--hover);
		color: var(--fg);
	}

	.nav-back {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.75rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--fg-muted);
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.nav-back:hover {
		background: var(--hover);
		color: var(--fg);
	}

	.admin-content {
		max-width: 72rem;
		margin: 0 auto;
		padding: 1.5rem;
	}
</style>
