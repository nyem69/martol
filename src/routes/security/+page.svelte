<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import {
		ArrowLeft,
		ArrowRight,
		Lock,
		CheckCircle,
		ExternalLink
	} from '@lucide/svelte';

	function reveal(node: HTMLElement) {
		node.classList.add('reveal');
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					node.classList.add('revealed');
					observer.unobserve(node);
				}
			},
			{ threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	const comparisonRows = [
		{ dim: 'Where agents run', unsafe: 'Your machine, your privileges', martol: 'Server-side, sandboxed per room' },
		{ dim: 'What agents can do', unsafe: 'Anything — shell, files, network', martol: 'Only submit structured intents' },
		{ dim: 'Who decides', unsafe: 'Agent decides and executes', martol: 'Server validates against role x risk matrix' },
		{ dim: 'Trust model', unsafe: 'Trust the agent, hope for the best', martol: 'Zero trust — every action gated by server' },
		{ dim: 'Dangerous actions', unsafe: 'Execute immediately', martol: 'Queued in pending_actions, require human approval' },
		{ dim: 'WebSocket security', unsafe: 'Localhost, no auth', martol: 'HMAC-signed identity, org-scoped, signature-expiring' },
		{ dim: 'Plugins/skills', unsafe: 'Unvetted marketplace', martol: 'No marketplace — agents connect via authenticated MCP' },
		{ dim: 'Multi-user', unsafe: 'Single user, local', martol: 'Multi-user with hierarchical roles' },
		{ dim: 'Audit trail', unsafe: 'Local logs (modifiable)', martol: 'Append-only server DB with role audit' }
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
		{ role: 'Member', low: 'Needs approval', med: 'Needs approval', high: 'Needs approval', approve: 'No' },
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
	<link rel="canonical" href="https://martol.plitix.com/security" />

	<!-- Open Graph -->
	<meta property="og:title" content="Security Architecture — Martol" />
	<meta property="og:description" content={m.security_subtitle()} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://martol.plitix.com/security" />
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

<div class="landing scrollbar-thin">

	<!-- HEADER -->
	<section class="section header-section">
		<div class="container">
			<a href="/" class="back-link">
				<ArrowLeft size={14} />
				{m.security_back()}
			</a>
			<h1 class="page-title">{m.security_title()}</h1>
			<p class="page-subtitle">{m.security_subtitle()}</p>
		</div>
	</section>

	<!-- THE PROBLEM -->
	<section class="section" use:reveal>
		<div class="container">
			{@render sectionHead(m.security_problem_title())}
			<p class="lead">{m.security_problem_p1()}</p>
			<p class="lead">{m.security_problem_p2()}</p>
			<p class="lead">{m.security_problem_p3()}</p>
		</div>
	</section>

	<!-- HOW MARTOL IS DIFFERENT -->
	<section class="section" use:reveal>
		<div class="container">
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
		</div>
	</section>

	<!-- THE APPROVAL FLOW -->
	<section class="section" use:reveal>
		<div class="container">
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
		</div>
	</section>

	<!-- ROLE AUTHORITY MODEL -->
	<section class="section" use:reveal>
		<div class="container">
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
		</div>
	</section>

	<!-- INFRASTRUCTURE SECURITY -->
	<section class="section" use:reveal>
		<div class="container">
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
		</div>
	</section>

	<!-- CTA -->
	<section class="section" use:reveal>
		<div class="container">
			<div class="cta-row">
				<a href="/login" class="cta" data-testid="security-cta">
					{m.security_cta()} <ArrowRight size={16} />
				</a>
				<a href="https://github.com/nyem69/martol" class="cta-secondary" target="_blank" rel="noopener">
					{m.security_cta_github()} <ExternalLink size={14} />
				</a>
			</div>
		</div>
	</section>

	<!-- FOOTER -->
	<footer class="landing-footer">
		<div class="container footer-inner">
			<div class="footer-brand">
				<span class="footer-logo">MARTOL</span>
				<span class="footer-tagline">hammer, in Javanese</span>
			</div>
			<nav class="footer-links" aria-label="Footer navigation">
				<a href="https://github.com/nyem69/martol" target="_blank" rel="noopener">GitHub</a>
				<a href="/security">Security</a>
				<a href="/legal/terms">Terms</a>
				<a href="/legal/privacy">Privacy</a>
				<a href="/legal/aup">Acceptable Use</a>
			</nav>
			<p class="footer-copy">
				&copy; 2026 nyem &middot; AGPL-3.0
			</p>
		</div>
	</footer>

</div>

<style>
	/* ── Scrollable wrapper ── */
	.landing {
		height: 100dvh;
		overflow-y: auto;
		overflow-x: hidden;
	}

	/* ── Sections ── */
	.section {
		padding: 80px 0;
	}

	.header-section {
		padding-top: 48px;
		padding-bottom: 40px;
	}

	.container {
		max-width: 896px;
		margin: 0 auto;
		padding: 0 24px;
	}

	/* ── Section header ── */
	.section-header {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 40px;
	}

	.section-label {
		font-family: var(--font-mono);
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

	/* ── Back link ── */
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--text-muted);
		text-decoration: none;
		margin-bottom: 32px;
		transition: color 200ms ease;
	}

	.back-link:hover {
		color: var(--accent);
	}

	/* ── Page title ── */
	.page-title {
		font-family: var(--font-mono);
		font-size: clamp(32px, 6vw, 48px);
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.05em;
		margin: 0 0 16px;
		line-height: 1.1;
	}

	.page-subtitle {
		font-family: var(--font-sans);
		font-size: clamp(15px, 2.5vw, 18px);
		color: var(--text-muted);
		line-height: 1.6;
		margin: 0;
		max-width: 640px;
	}

	/* ── Lead text ── */
	.lead {
		font-family: var(--font-sans);
		font-size: 18px;
		color: var(--text);
		line-height: 1.6;
		margin: 0 0 12px;
	}

	.lead:last-child {
		margin-bottom: 0;
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
		font-family: var(--font-sans);
		font-size: 13px;
	}

	.comparison-table thead {
		background: var(--bg-elevated);
	}

	.comparison-table th {
		padding: 12px 16px;
		font-family: var(--font-mono);
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
		font-family: var(--font-mono);
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
		font-family: var(--font-mono);
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
		font-family: var(--font-mono);
		font-size: 15px;
		font-weight: 700;
		color: var(--text);
		margin: 0 0 4px;
	}

	.timeline-desc {
		font-family: var(--font-sans);
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
		font-family: var(--font-sans);
		font-size: 14px;
		color: var(--text-muted);
		line-height: 1.6;
	}

	.roles-note :global(svg) {
		color: var(--accent);
		flex-shrink: 0;
		margin-top: 3px;
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
		font-family: var(--font-sans);
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
		justify-content: center;
		gap: 16px;
		flex-wrap: wrap;
	}

	.cta {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
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
		font-family: var(--font-mono);
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

	/* ── Footer ── */
	.landing-footer {
		padding: 40px 0;
		border-top: 1px solid var(--border-subtle);
	}

	.footer-inner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.footer-brand {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.footer-logo {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.1em;
	}

	.footer-tagline {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-muted);
		font-style: italic;
	}

	.footer-links {
		display: flex;
		gap: 20px;
	}

	.footer-links a {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-muted);
		text-decoration: none;
	}

	.footer-links a:hover {
		color: var(--accent);
	}

	.footer-copy {
		width: 100%;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 11px;
		color: oklch(0.40 0.01 260);
		margin: 8px 0 0;
	}

	/* ── Scroll reveal ── */
	.section:global(.reveal) {
		opacity: 0;
		transform: translateY(24px);
		transition: opacity 0.7s ease, transform 0.7s ease;
	}

	.section:global(.revealed) {
		opacity: 1;
		transform: translateY(0);
	}

	/* ── Reduced motion ── */
	@media (prefers-reduced-motion: reduce) {
		.section:global(.reveal) {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}
	}

	/* ── Mobile ── */
	@media (max-width: 640px) {
		.section {
			padding: 60px 0;
		}

		.header-section {
			padding-top: 32px;
			padding-bottom: 24px;
		}

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

		.footer-inner {
			flex-direction: column;
			text-align: center;
		}

		.footer-links {
			justify-content: center;
		}
	}
</style>
