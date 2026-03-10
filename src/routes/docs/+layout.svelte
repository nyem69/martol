<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import { ArrowLeft } from '@lucide/svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();

	const tabs = [
		{ href: '/docs', label: 'Overview' },
		{ href: '/docs/chat', label: 'Chat' },
		{ href: '/docs/client', label: 'Agent Client' },
		{ href: '/docs/security', label: 'Security' },
		{ href: '/docs/pricing', label: 'Pricing' },
		{ href: '/docs/credits', label: 'Credits' },
		{ href: '/docs/contact', label: 'Contact' }
	];

	const currentPath = $derived(page.url.pathname);
</script>

<div class="docs-shell">
	<nav class="docs-topnav">
		<a href="/chat" class="back-link" aria-label="Back to app">
			<ArrowLeft size={16} />
		</a>
		<a href="/docs" class="topnav-brand">
			<span class="topnav-logo">m</span>
			<span class="topnav-title">{m.app_name()}</span>
			<span class="topnav-badge">docs</span>
		</a>
		<ThemeToggle size={14} />
		<div class="topnav-tabs">
			{#each tabs as tab}
				<a
					href={tab.href}
					class="topnav-tab"
					class:active={currentPath === tab.href}
				>
					{tab.label}
				</a>
			{/each}
		</div>
	</nav>
	{@render children()}
</div>

<style>
	.docs-shell {
		min-height: 100dvh;
		background: var(--bg);
	}

	.docs-topnav {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 48px;
		background: color-mix(in oklch, var(--bg) 92%, transparent);
		backdrop-filter: blur(16px) saturate(1.4);
		-webkit-backdrop-filter: blur(16px) saturate(1.4);
		border-bottom: 1px solid var(--border);
		z-index: 110;
		display: flex;
		align-items: center;
		padding: 0 20px;
		gap: 12px;
	}

	.back-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		color: var(--text-muted);
		text-decoration: none;
		transition: all 0.12s;
	}

	.back-link:hover {
		color: var(--text);
		background: color-mix(in oklch, var(--text) 8%, transparent);
	}

	.topnav-brand {
		display: flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
		margin-right: 8px;
	}

	.topnav-logo {
		width: 20px;
		height: 20px;
		background: linear-gradient(135deg, var(--accent), var(--accent-muted));
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono-alt);
		font-size: 11px;
		font-weight: 500;
		color: var(--bg);
	}

	.topnav-title {
		font-family: var(--font-mono-alt);
		font-size: 14px;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.02em;
	}

	.topnav-badge {
		font-family: var(--font-mono-alt);
		font-size: 10px;
		color: var(--text-muted);
		background: color-mix(in oklch, var(--text) 6%, transparent);
		border: 1px solid var(--border);
		padding: 1px 6px;
		border-radius: 3px;
	}

	.topnav-tabs {
		display: flex;
		gap: 2px;
		margin-left: auto;
	}

	.topnav-tab {
		font-family: var(--font-mono-alt);
		font-size: 12.5px;
		color: var(--text-muted);
		text-decoration: none;
		padding: 6px 12px;
		border-radius: 5px;
		transition: all 0.12s;
	}

	.topnav-tab:hover {
		color: var(--text);
		background: color-mix(in oklch, var(--text) 8%, transparent);
	}

	.topnav-tab.active {
		color: var(--accent);
		background: color-mix(in oklch, var(--accent) 12%, transparent);
	}

	@media (max-width: 640px) {
		.topnav-title {
			display: none;
		}

		.topnav-tab {
			font-size: 11.5px;
			padding: 5px 8px;
		}
	}
</style>
