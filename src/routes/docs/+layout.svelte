<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import { ArrowLeft } from '@lucide/svelte';

	let { children } = $props();

	const tabs = [
		{ href: '/docs', label: 'Overview' },
		{ href: '/docs/chat', label: 'Chat' },
		{ href: '/docs/client', label: 'Agent Client' },
		{ href: '/docs/pricing', label: 'Pricing' }
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
		background: rgba(8, 9, 10, 0.92);
		backdrop-filter: blur(16px) saturate(1.4);
		-webkit-backdrop-filter: blur(16px) saturate(1.4);
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
		color: rgba(255, 255, 255, 0.5);
		text-decoration: none;
		transition: all 0.12s;
	}

	.back-link:hover {
		color: rgba(255, 255, 255, 0.9);
		background: rgba(255, 255, 255, 0.08);
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
		color: rgba(255, 255, 255, 0.95);
		letter-spacing: -0.02em;
	}

	.topnav-badge {
		font-family: var(--font-mono-alt);
		font-size: 10px;
		color: rgba(255, 255, 255, 0.5);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
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
		color: rgba(255, 255, 255, 0.6);
		text-decoration: none;
		padding: 6px 12px;
		border-radius: 5px;
		transition: all 0.12s;
	}

	.topnav-tab:hover {
		color: rgba(255, 255, 255, 0.95);
		background: rgba(255, 255, 255, 0.08);
	}

	.topnav-tab.active {
		color: oklch(0.82 0.15 65);
		background: oklch(0.75 0.15 65 / 0.12);
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
