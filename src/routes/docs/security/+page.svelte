<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import {
		Menu,
		X,
		Lock,
		CheckCircle,
		ArrowRight,
		ExternalLink
	} from '@lucide/svelte';

	let sidebarOpen = $state(false);
	let activeSection = $state('problem');

	const navGroups = [
		{
			label: 'Overview',
			links: [
				{ id: 'problem', text: 'The Problem' },
				{ id: 'comparison', text: 'How Martol Is Different' }
			]
		},
		{
			label: 'Architecture',
			links: [
				{ id: 'approval-flow', text: 'The Approval Flow' },
				{ id: 'roles', text: 'Role Authority Model' }
			]
		},
		{
			label: 'Infrastructure',
			links: [
				{ id: 'infra', text: 'Infrastructure Security' }
			]
		}
	];

	function scrollTrack(node: HTMLElement) {
		const allIds = navGroups.flatMap((g) => g.links.map((l) => l.id));

		function update() {
			const scrollY = node.scrollTop + 120;
			let current = allIds[0];
			for (const id of allIds) {
				const el = node.querySelector(`#${id}`) as HTMLElement | null;
				if (el && el.offsetTop <= scrollY) current = id;
			}
			activeSection = current;
		}

		node.addEventListener('scroll', update, { passive: true });
		update();
		return { destroy: () => node.removeEventListener('scroll', update) };
	}

	function navClick(id: string) {
		sidebarOpen = false;
		const el = document.getElementById(id);
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	const comparisonRows = [
		{ dim: 'Where agents run', unsafe: 'Your machine, your privileges', martol: 'Local machine, scoped to a shared room' },
		{ dim: 'What agents can do', unsafe: 'Anything — shell, files, network', martol: 'Chat + submit structured intents via restricted tools' },
		{ dim: 'Who decides', unsafe: 'Agent decides and executes', martol: 'Server checks role × risk matrix for approval' },
		{ dim: 'Trust model', unsafe: 'Trust the agent, hope for the best', martol: 'Approval steps for sensitive actions' },
		{ dim: 'Dangerous actions', unsafe: 'Execute immediately', martol: 'Queued for human approval' },
		{ dim: 'WebSocket security', unsafe: 'Localhost, no auth', martol: 'HMAC-signed identity, org-scoped, signature-expiring' },
		{ dim: 'Plugins/skills', unsafe: 'Unvetted marketplace', martol: 'No marketplace — agents connect via authenticated MCP' },
		{ dim: 'Multi-user', unsafe: 'Single user, local', martol: 'Multi-user with hierarchical roles' },
		{ dim: 'History', unsafe: 'Local logs, per developer', martol: 'Shared chat history on server' }
	];

	const flowSteps = [
		{ title: m.security_flow_step1_title(), desc: m.security_flow_step1_desc() },
		{ title: m.security_flow_step2_title(), desc: m.security_flow_step2_desc() },
		{ title: m.security_flow_step3_title(), desc: m.security_flow_step3_desc() },
		{ title: m.security_flow_step4_title(), desc: m.security_flow_step4_desc() },
		{ title: m.security_flow_step5_title(), desc: m.security_flow_step5_desc() },
		{ title: m.security_flow_step6_title(), desc: m.security_flow_step6_desc() },
		{ title: m.security_flow_step7_title(), desc: m.security_flow_step7_desc() }
	];

	const roleRows = [
		{ role: 'Owner', low: 'auto', med: 'auto', high: 'auto', approve: 'Yes' },
		{ role: 'Lead', low: 'auto', med: 'auto', high: 'Needs owner', approve: 'Yes (low/med)' },
		{ role: 'Member', low: 'auto', med: 'Needs lead', high: 'Rejected*', approve: 'No' },
		{ role: 'Agent', low: 'Submit only', med: 'Submit only', high: 'Submit only', approve: 'Never' }
	];

	const infraItems = [
		{ key: 'hmac', text: m.security_infra_hmac() },
		{ key: 'scoped', text: m.security_infra_scoped() },
		{ key: 'session', text: m.security_infra_session() },
		{ key: 'csp', text: m.security_infra_csp() },
		{ key: 'ratelimit', text: m.security_infra_ratelimit() },
		{ key: 'marketplace', text: m.security_infra_marketplace() },
		{ key: 'audit', text: m.security_infra_audit() }
	];
</script>

{#snippet sectionHead(label: string)}
	<div class="section-header">
		<span class="section-label">{label}</span>
		<div class="section-line"></div>
	</div>
{/snippet}

<svelte:head>
	<title>Security Architecture — Martol</title>
	<meta name="description" content={m.security_subtitle()} />
	<link rel="canonical" href="https://martol.plitix.com/docs/security" />

	<!-- Open Graph -->
	<meta property="og:title" content="Security Architecture — Martol" />
	<meta property="og:description" content={m.security_subtitle()} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://martol.plitix.com/docs/security" />
	<meta property="og:image" content="https://martol.plitix.com/images/martol-hero-2.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:site_name" content="Martol" />

	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Security Architecture — Martol" />
	<meta name="twitter:description" content={m.security_subtitle()} />
	<meta name="twitter:image" content="https://martol.plitix.com/images/martol-hero-2.png" />
</svelte:head>

<div class="docs-layout" use:scrollTrack>
	<!-- Mobile menu toggle -->
	<button
		type="button"
		class="menu-toggle"
		onclick={() => (sidebarOpen = !sidebarOpen)}
		aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
	>
		{#if sidebarOpen}
			<X size={20} />
		{:else}
			<Menu size={20} />
		{/if}
	</button>

	<!-- Sidebar -->
	<nav class="docs-sidebar {sidebarOpen ? 'open' : ''}">
		{#each navGroups as group}
			<div class="nav-group">
				<div class="nav-group-label">{group.label}</div>
				{#each group.links as link}
					<button
						type="button"
						class="nav-link {activeSection === link.id ? 'active' : ''}"
						onclick={() => navClick(link.id)}
					>
						{link.text}
					</button>
				{/each}
			</div>
		{/each}
	</nav>

	<!-- Overlay for mobile sidebar -->
	{#if sidebarOpen}
		<button
			type="button"
			class="sidebar-overlay"
			onclick={() => (sidebarOpen = false)}
			aria-label="Close sidebar"
		></button>
	{/if}

	<!-- Main content -->
	<main class="docs-main">
		<!-- Hero -->
		<section class="docs-hero">
			<h1 class="hero-title">{m.security_title()}</h1>
			<p class="hero-tagline">{m.security_subtitle()}</p>
		</section>

		<hr class="section-divider" />

		<!-- THE PROBLEM -->
		<section class="page-section" id="problem">
			{@render sectionHead(m.security_problem_title())}
			<p>{m.security_problem_p1()}</p>
			<p>{m.security_problem_p2()}</p>
			<p>{m.security_problem_p3()}</p>
		</section>

		<!-- HOW MARTOL IS DIFFERENT -->
		<section class="page-section" id="comparison">
			{@render sectionHead(m.security_comparison_title())}
			<div class="comparison-table-wrap scrollbar-thin">
				<table class="comparison-table">
					<thead>
						<tr>
							<th>Dimension</th>
							<th class="col-unsafe">{m.section_security_unsafe()}</th>
							<th class="col-martol">{m.section_security_martol()}</th>
						</tr>
					</thead>
					<tbody>
						{#each comparisonRows as row}
							<tr>
								<td class="row-label">{row.dim}</td>
								<td class="cell-unsafe">{row.unsafe}</td>
								<td class="cell-martol">{row.martol}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<!-- THE APPROVAL FLOW -->
		<section class="page-section" id="approval-flow">
			{@render sectionHead(m.security_flow_title())}
			<div class="timeline">
				{#each flowSteps as step, i}
					<div class="timeline-step">
						<div class="timeline-marker">
							<span class="step-num">{i + 1}</span>
						</div>
						<div class="timeline-content">
							<h3 class="timeline-title">{step.title}</h3>
							<p class="timeline-desc">{step.desc}</p>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- ROLE AUTHORITY MODEL -->
		<section class="page-section" id="roles">
			{@render sectionHead(m.security_roles_title())}
			<div class="comparison-table-wrap scrollbar-thin">
				<table class="comparison-table roles-table">
					<thead>
						<tr>
							<th>Role</th>
							<th>Low Risk</th>
							<th>Medium Risk</th>
							<th>High Risk</th>
							<th>Can Approve Others</th>
						</tr>
					</thead>
					<tbody>
						{#each roleRows as row}
							<tr>
								<td class="row-label">{row.role}</td>
								<td>
									{#if row.low === 'auto'}
										<span class="cell-auto"><CheckCircle size={14} /> Auto</span>
									{:else}
										<span class="cell-restricted">{row.low}</span>
									{/if}
								</td>
								<td>
									{#if row.med === 'auto'}
										<span class="cell-auto"><CheckCircle size={14} /> Auto</span>
									{:else}
										<span class="cell-restricted">{row.med}</span>
									{/if}
								</td>
								<td>
									{#if row.high === 'auto'}
										<span class="cell-auto"><CheckCircle size={14} /> Auto</span>
									{:else}
										<span class="cell-restricted">{row.high}</span>
									{/if}
								</td>
								<td>
									<span class={row.approve === 'Never' || row.approve === 'No' ? 'cell-restricted' : 'cell-approve'}>
										{row.approve}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="roles-note">
				<Lock size={14} />
				<span>{m.security_roles_note()}</span>
			</div>
			<p class="roles-footnote">* Destructive high-risk actions (delete, deploy, config change) are rejected outright for members.</p>
		</section>

		<!-- INFRASTRUCTURE SECURITY -->
		<section class="page-section" id="infra">
			{@render sectionHead(m.security_infra_title())}
			<ul class="infra-list">
				{#each infraItems as item}
					{@const dashIndex = item.text.indexOf(' — ')}
					<li class="infra-item">
						<div class="infra-icon">
							<Lock size={14} />
						</div>
						<div class="infra-text">
							{#if dashIndex > -1}
								<strong>{item.text.slice(0, dashIndex)}</strong>
								<span class="infra-desc"> — {item.text.slice(dashIndex + 3)}</span>
							{:else}
								<span>{item.text}</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>

		<!-- CTA -->
		<section class="page-section">
			<div class="cta-row">
				<a href="/login" class="cta" data-testid="security-cta">
					{m.security_cta()} <ArrowRight size={16} />
				</a>
				<a href="https://github.com/nyem69/martol" class="cta-secondary" target="_blank" rel="noopener">
					{m.security_cta_github()} <ExternalLink size={14} />
				</a>
			</div>
		</section>
	</main>
</div>

<style>
	/* ── Layout ── */
	.docs-layout {
		height: 100dvh;
		overflow-y: auto;
		overflow-x: hidden;
		scroll-behavior: smooth;
		scroll-padding-top: 80px;
	}

	/* ── Sidebar ── */
	.docs-sidebar {
		position: fixed;
		top: 48px;
		left: 0;
		width: 240px;
		height: calc(100vh - 48px);
		overflow-y: auto;
		background: var(--bg-surface);
		border-right: 1px solid var(--border);
		padding: 20px 0;
		z-index: 90;
	}

	.nav-group {
		margin-bottom: 20px;
	}

	.nav-group-label {
		font-family: var(--font-mono-alt);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		padding: 6px 20px;
	}

	.nav-link {
		display: block;
		width: 100%;
		text-align: left;
		font-family: var(--font-serif);
		font-size: 13.5px;
		color: var(--text-muted);
		padding: 5px 20px;
		background: none;
		border: none;
		cursor: pointer;
		transition: color 0.15s;
		line-height: 1.4;
	}

	.nav-link:hover {
		color: var(--text);
	}

	.nav-link.active {
		color: var(--accent);
		border-left: 2px solid var(--accent);
		padding-left: 18px;
	}

	/* ── Menu toggle (mobile) ── */
	.menu-toggle {
		display: none;
		position: fixed;
		top: 56px;
		left: 12px;
		z-index: 100;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px;
		color: var(--text);
		cursor: pointer;
	}

	.sidebar-overlay {
		display: none;
	}

	/* ── Main content ── */
	.docs-main {
		margin-left: 240px;
		padding: 88px 48px 120px;
		max-width: calc(240px + 820px);
		font-family: var(--font-serif);
		font-size: 16.5px;
		line-height: 1.72;
		color: var(--text);
	}

	.page-section {
		margin-bottom: 72px;
		padding-top: 8px;
	}

	/* ── Hero ── */
	.hero-title {
		font-family: var(--font-mono-alt);
		font-size: 28px;
		font-weight: 500;
		color: var(--accent);
		letter-spacing: -0.03em;
		margin-bottom: 12px;
		line-height: 1.2;
	}

	.hero-tagline {
		font-family: var(--font-serif);
		font-size: 17px;
		color: var(--text-muted);
		font-style: italic;
		margin: 0;
		line-height: 1.6;
	}

	.section-divider {
		border: none;
		border-top: 1px solid var(--border);
		margin: 48px 0;
	}

	/* ── Section header ── */
	.section-header {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 32px;
	}

	.section-label {
		font-family: var(--font-mono-alt);
		font-size: 12px;
		color: var(--accent-muted);
		white-space: nowrap;
		letter-spacing: 0.5px;
	}

	.section-line {
		flex: 1;
		height: 1px;
		background: var(--border-subtle);
	}

	/* ── Comparison table ── */
	.comparison-table-wrap {
		overflow-x: auto;
		margin-bottom: 20px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}

	.comparison-table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-serif);
		font-size: 13px;
	}

	.comparison-table thead {
		background: var(--bg-elevated);
	}

	.comparison-table th {
		padding: 12px 16px;
		font-family: var(--font-mono-alt);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.5px;
		text-align: left;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	.comparison-table th:first-child {
		width: 22%;
	}

	.col-unsafe {
		color: var(--danger);
	}

	.col-martol {
		color: var(--success);
	}

	.comparison-table td {
		padding: 10px 16px;
		border-bottom: 1px solid var(--border-subtle);
		line-height: 1.5;
	}

	.comparison-table tr:last-child td {
		border-bottom: none;
	}

	.row-label {
		font-family: var(--font-mono-alt);
		font-size: 12px;
		color: var(--text-muted);
		font-weight: 500;
		white-space: nowrap;
	}

	.cell-unsafe {
		color: var(--text-muted);
	}

	.cell-martol {
		color: var(--text);
	}

	/* ── Timeline ── */
	.timeline {
		position: relative;
		padding-left: 0;
	}

	.timeline-step {
		display: flex;
		gap: 20px;
		position: relative;
		padding-bottom: 32px;
	}

	.timeline-step:last-child {
		padding-bottom: 0;
	}

	.timeline-marker {
		position: relative;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.timeline-marker::after {
		content: '';
		position: absolute;
		top: 32px;
		left: 50%;
		transform: translateX(-50%);
		width: 1px;
		height: calc(100% + 0px);
		background: var(--border);
	}

	.timeline-step:last-child .timeline-marker::after {
		display: none;
	}

	.step-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--bg);
		font-family: var(--font-mono-alt);
		font-size: 13px;
		font-weight: 700;
		flex-shrink: 0;
		position: relative;
		z-index: 1;
	}

	.timeline-content {
		padding-top: 2px;
	}

	.timeline-title {
		font-family: var(--font-mono-alt);
		font-size: 15px;
		font-weight: 700;
		color: var(--text);
		margin: 0 0 4px;
	}

	.timeline-desc {
		font-family: var(--font-serif);
		font-size: 14px;
		color: var(--text-muted);
		line-height: 1.6;
		margin: 0;
	}

	/* ── Roles table ── */
	.roles-table th {
		white-space: nowrap;
	}

	.cell-auto {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--success);
		font-weight: 500;
	}

	.cell-auto :global(svg) {
		flex-shrink: 0;
	}

	.cell-restricted {
		color: var(--text-muted);
		font-size: 13px;
	}

	.cell-approve {
		color: var(--text);
		font-size: 13px;
	}

	.roles-note {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-top: 16px;
		padding: 12px 16px;
		border-left: 2px solid var(--accent-muted);
		background: oklch(0.75 0.15 65 / 0.04);
		border-radius: 0 4px 4px 0;
		font-family: var(--font-serif);
		font-size: 14px;
		color: var(--text-muted);
		line-height: 1.6;
	}

	.roles-note :global(svg) {
		color: var(--accent);
		flex-shrink: 0;
		margin-top: 3px;
	}

	.roles-footnote {
		margin-top: 8px;
		font-size: 12px;
		color: var(--text-muted);
		font-style: italic;
	}

	/* ── Infrastructure list ── */
	.infra-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.infra-item {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 14px 16px;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-surface);
		transition: border-color 200ms ease;
	}

	.infra-item:hover {
		border-color: var(--accent-muted);
	}

	.infra-icon {
		color: var(--accent);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.infra-text {
		font-family: var(--font-serif);
		font-size: 14px;
		color: var(--text);
		line-height: 1.6;
	}

	.infra-text strong {
		font-weight: 600;
		color: var(--text);
	}

	.infra-desc {
		color: var(--text-muted);
	}

	/* ── CTA ── */
	.cta-row {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}

	.cta {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono-alt);
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.5px;
		background: var(--accent);
		color: var(--bg);
		padding: 12px 28px;
		border-radius: 4px;
		text-decoration: none;
		transition: all 200ms ease;
	}

	.cta:hover {
		background: var(--accent-hover);
		box-shadow: 0 0 24px oklch(0.75 0.15 65 / 0.3);
		transform: translateY(-1px);
	}

	.cta:active {
		transform: translateY(0);
	}

	.cta-secondary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono-alt);
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.5px;
		background: transparent;
		color: var(--text);
		padding: 12px 28px;
		border-radius: 4px;
		border: 1px solid var(--border);
		text-decoration: none;
		transition: all 200ms ease;
	}

	.cta-secondary:hover {
		border-color: var(--accent-muted);
		color: var(--accent);
		transform: translateY(-1px);
	}

	.cta-secondary:active {
		transform: translateY(0);
	}

	/* ── Mobile ── */
	@media (max-width: 860px) {
		.menu-toggle {
			display: flex;
		}

		.docs-sidebar {
			transform: translateX(-100%);
			transition: transform 0.25s ease;
			z-index: 95;
		}

		.docs-sidebar.open {
			transform: translateX(0);
		}

		.sidebar-overlay {
			display: block;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.5);
			z-index: 89;
			border: none;
			cursor: default;
		}

		.docs-main {
			margin-left: 0;
			padding: 84px 20px 80px;
		}
	}

	@media (max-width: 640px) {
		.comparison-table th:first-child {
			width: auto;
		}

		.timeline-step {
			gap: 14px;
		}

		.cta-row {
			flex-direction: column;
		}

		.cta,
		.cta-secondary {
			width: 100%;
			justify-content: center;
		}
	}
</style>
