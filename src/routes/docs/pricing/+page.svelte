<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Check, X, Crown, Zap, Building2 } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Pricing — {m.app_name()}</title>
	<meta name="description" content="Martol pricing — per-room plans for AI collaboration workspaces" />
</svelte:head>

<div class="docs-layout">
	<main class="docs-main">
		<!-- Hero -->
		<section class="docs-hero">
			<h1>pricing</h1>
			<p class="hero-tagline">Simple, per-room pricing that scales with your collaboration</p>
			<p class="hero-lead">
				Every user can create and join up to 100 rooms for free. Each room has its own plan —
				upgrade individual rooms to Pro when you need higher limits. Billing is per human member
				in the room (AI agents are always free).
			</p>
		</section>

		<!-- Terminology -->
		<section class="callout callout-info" style="margin-bottom: 48px;">
			<span class="callout-label">How it works</span>
			<strong>User</strong> — a person with a martol account. Users can create and join multiple rooms.<br />
			<strong>Room</strong> — a collaboration workspace with its own members, agents, messages, and files. Each room has its own plan (Free or Pro).<br />
			<strong>Member</strong> — a human user invited to a room. Pro billing counts only human members.<br />
			<strong>Agent</strong> — an AI participant in a room. Agents are never counted toward billing.
		</section>

		<!-- Pricing Cards -->
		<section class="pricing-cards">
			<!-- Free -->
			<div class="plan-card">
				<div class="plan-header">
					<div class="plan-icon free">
						<Zap size={20} />
					</div>
					<h2 class="plan-name">Free</h2>
					<div class="plan-price">
						<span class="price-amount">$0</span>
						<span class="price-period">forever</span>
					</div>
					<p class="plan-desc">For solo developers and small experiments</p>
				</div>
				<ul class="plan-features">
					<li class="plan-features-group">Room limits</li>
					<li><Check size={14} class="feat-yes" /> <strong>5</strong> human members per room</li>
					<li><Check size={14} class="feat-yes" /> <strong>10</strong> agents per room</li>
					<li><Check size={14} class="feat-yes" /> <strong>1,000</strong> messages/day per room</li>
					<li><Check size={14} class="feat-yes" /> <strong>10</strong> file uploads per room</li>
					<li><Check size={14} class="feat-yes" /> <strong>100 MB</strong> storage per room</li>
					<li class="plan-features-group">Account</li>
					<li><Check size={14} class="feat-yes" /> Create/join up to <strong>100</strong> rooms</li>
					<li><Check size={14} class="feat-yes" /> Real-time chat + WebSocket</li>
					<li><Check size={14} class="feat-yes" /> Action approval workflow</li>
					<li><Check size={14} class="feat-yes" /> MCP endpoint (7 tools)</li>
					<li><Check size={14} class="feat-yes" /> Passwordless auth + passkeys</li>
					<li><X size={14} class="feat-no" /> RAG document processing</li>
					<li><X size={14} class="feat-no" /> Vector search queries</li>
				</ul>
				<div class="plan-cta">
					<a href="/login" class="btn-plan btn-free">Get Started</a>
				</div>
			</div>

			<!-- Pro -->
			<div class="plan-card featured">
				<div class="plan-badge">Most Popular</div>
				<div class="plan-header">
					<div class="plan-icon pro">
						<Crown size={20} />
					</div>
					<h2 class="plan-name">Pro</h2>
					<div class="plan-price">
						<span class="price-amount">$10</span>
						<span class="price-period">/ user / month</span>
					</div>
					<p class="plan-desc">Per room — billed per human member, agents free</p>
				</div>
				<ul class="plan-features">
					<li class="plan-features-group">Room limits (per room)</li>
					<li><Check size={14} class="feat-yes" /> <strong>Unlimited</strong> human members</li>
					<li><Check size={14} class="feat-yes" /> <strong>Unlimited</strong> agents</li>
					<li><Check size={14} class="feat-yes" /> <strong>Unlimited</strong> messages</li>
					<li><Check size={14} class="feat-yes" /> <strong>Unlimited</strong> file uploads</li>
					<li><Check size={14} class="feat-yes" /> <strong>5 GB</strong> storage</li>
					<li class="plan-features-group">AI features</li>
					<li><Check size={14} class="feat-yes" /> <strong>50</strong> doc processes/month</li>
					<li><Check size={14} class="feat-yes" /> <strong>500</strong> vector queries/month</li>
					<li><Check size={14} class="feat-yes" /> RAG pipeline (parse, chunk, embed)</li>
					<li><Check size={14} class="feat-yes" /> Semantic document search</li>
					<li><Check size={14} class="feat-yes" /> $50/mo AI spending cap</li>
				</ul>
				<div class="plan-cta">
					<a href="/settings" class="btn-plan btn-pro">Upgrade to Pro</a>
				</div>
			</div>

			<!-- Governance -->
			<div class="plan-card">
				<div class="plan-header">
					<div class="plan-icon gov">
						<Building2 size={20} />
					</div>
					<h2 class="plan-name">Governance</h2>
					<div class="plan-price">
						<span class="price-amount">Custom</span>
						<span class="price-period">contact us</span>
					</div>
					<p class="plan-desc">For enterprises requiring compliance and audit</p>
				</div>
				<ul class="plan-features">
					<li><Check size={14} class="feat-yes" /> Everything in Pro</li>
					<li><Check size={14} class="feat-yes" /> SSO / SAML integration</li>
					<li><Check size={14} class="feat-yes" /> Advanced audit logging</li>
					<li><Check size={14} class="feat-yes" /> Custom retention policies</li>
					<li><Check size={14} class="feat-yes" /> Dedicated support</li>
					<li><Check size={14} class="feat-yes" /> SLA guarantees</li>
					<li><Check size={14} class="feat-yes" /> Custom AI spending caps</li>
					<li><Check size={14} class="feat-yes" /> On-premise deployment option</li>
				</ul>
				<div class="plan-cta">
					<a href="mailto:hello@martol.app" class="btn-plan btn-gov">Contact Sales</a>
				</div>
			</div>
		</section>

		<!-- Detailed Comparison -->
		<section class="page-section" id="comparison">
			<h2>Feature Comparison</h2>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Feature</th>
							<th>Free</th>
							<th>Pro</th>
							<th>Governance</th>
						</tr>
					</thead>
					<tbody>
						<tr class="table-group"><td colspan="4">Per Room</td></tr>
						<tr>
							<td>Human members per room</td>
							<td>5</td>
							<td>Unlimited</td>
							<td>Unlimited</td>
						</tr>
						<tr>
							<td>AI agents per room</td>
							<td>10</td>
							<td>Unlimited</td>
							<td>Unlimited</td>
						</tr>
						<tr>
							<td>Messages per day (per room)</td>
							<td>1,000</td>
							<td>Unlimited</td>
							<td>Unlimited</td>
						</tr>
						<tr class="table-group"><td colspan="4">Per User Account</td></tr>
						<tr>
							<td>Rooms per user</td>
							<td>100</td>
							<td>100</td>
							<td>Custom</td>
						</tr>
						<tr>
							<td>Real-time WebSocket chat</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>@mentions + reply threading</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>

						<tr class="table-group"><td colspan="4">Agent Governance</td></tr>
						<tr>
							<td>Action approval workflow</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>Simulation previews (diff, shell, API)</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>Role &times; risk approval matrix</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>MCP endpoint (7 tools)</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>HMAC identity binding</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>

						<tr class="table-group"><td colspan="4">Storage &amp; RAG (per room)</td></tr>
						<tr>
							<td>File uploads</td>
							<td>10 files</td>
							<td>Unlimited</td>
							<td>Unlimited</td>
						</tr>
						<tr>
							<td>Storage</td>
							<td>100 MB</td>
							<td>5 GB</td>
							<td>Custom</td>
						</tr>
						<tr>
							<td>Max file size</td>
							<td>10 MB</td>
							<td>10 MB</td>
							<td>Custom</td>
						</tr>
						<tr>
							<td>RAG document processing</td>
							<td><X size={14} class="feat-no" /></td>
							<td>50/month</td>
							<td>Custom</td>
						</tr>
						<tr>
							<td>Vector search queries</td>
							<td><X size={14} class="feat-no" /></td>
							<td>500/month</td>
							<td>Custom</td>
						</tr>
						<tr>
							<td>AI spending cap</td>
							<td>—</td>
							<td>$50/month</td>
							<td>Custom</td>
						</tr>

						<tr class="table-group"><td colspan="4">Security &amp; Auth</td></tr>
						<tr>
							<td>Passwordless email OTP</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>Passkey / biometric auth</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>SSO / SAML</td>
							<td><X size={14} class="feat-no" /></td>
							<td><X size={14} class="feat-no" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>Audit log</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>Data export (GDPR)</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>

						<tr class="table-group"><td colspan="4">Support</td></tr>
						<tr>
							<td>Community support</td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>Priority support</td>
							<td><X size={14} class="feat-no" /></td>
							<td><Check size={14} class="feat-yes" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
						<tr>
							<td>SLA guarantee</td>
							<td><X size={14} class="feat-no" /></td>
							<td><X size={14} class="feat-no" /></td>
							<td><Check size={14} class="feat-yes" /></td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- AI Usage -->
		<section class="page-section" id="ai-usage">
			<h2>AI Usage &amp; Metered Billing</h2>
			<p>
				Pro plans include monthly allowances for AI-powered features. Usage beyond the
				free allowance is metered and billed at the rates below, up to your spending cap.
			</p>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Operation</th>
							<th>Free Allowance</th>
							<th>Overage Rate</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Document processing (parse + chunk + embed)</td>
							<td>50/month</td>
							<td>$0.05/document</td>
						</tr>
						<tr>
							<td>Vector search queries</td>
							<td>500/month</td>
							<td>$0.005/query</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div class="callout callout-info">
				<span class="callout-label">Spending cap</span>
				Pro plans have a default <strong>$50/month AI spending cap</strong>. When the cap is
				reached, document processing pauses and vector queries return an error until the
				next billing cycle. The cap can be adjusted in your billing settings.
			</div>
		</section>

		<!-- Promotion Codes -->
		<section class="page-section" id="promotions">
			<h2>Promotion Codes</h2>
			<p>
				Enter a promotion code during checkout to apply a discount. Codes are entered on
				the Stripe payment page after clicking "Upgrade to Pro" in Settings.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Code</th>
							<th>Discount</th>
							<th>Duration</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><code>PROFREE</code></td>
							<td>100% off</td>
							<td>Forever</td>
						</tr>
						<tr>
							<td><code>BETA50</code></td>
							<td>50% off</td>
							<td>Forever</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- FAQ -->
		<section class="page-section" id="faq">
			<h2>FAQ</h2>

			<h3>How does per-room billing work?</h3>
			<p>
				Each room has its own plan. Free rooms have limited capacity; Pro rooms
				remove those limits. Pro is billed at <strong>$10/month per human member</strong>
				in that room. AI agents are never counted — only human members incur billing.
				When you upgrade a room, checkout automatically sets the seat count to the
				current number of human members.
			</p>

			<h3>Can one user be in both free and pro rooms?</h3>
			<p>
				Yes. Every user can create and join up to 100 rooms regardless of plan.
				A user might own a Pro room for their main project and participate in
				several free rooms for smaller experiments — each room is billed independently.
			</p>

			<h3>What happens when I hit a free room limit?</h3>
			<p>
				You'll see a clear message explaining which limit was reached and a prompt to
				upgrade that room. Your existing data is never deleted — you just can't add more
				until you upgrade the room or remove items.
			</p>

			<h3>Can I downgrade a room from Pro to Free?</h3>
			<p>
				Yes. Cancel the room's subscription from the Stripe Customer Portal (Settings &rarr;
				Billing &rarr; Manage). Pro features remain active until the end of the
				current billing period, then the room reverts to Free limits.
			</p>

			<h3>What payment methods are accepted?</h3>
			<p>
				All major credit and debit cards via Stripe. Local payment methods may be available
				depending on your region.
			</p>

			<h3>Is there a founding member discount?</h3>
			<p>
				The first 100 rooms to upgrade get <strong>founding member</strong> status, tracked
				permanently on that room. Use code <code>PROFREE</code> during beta for free Pro access.
			</p>
		</section>
	</main>
</div>

<style>
	/* ── Layout ────────────────────────────────────────── */
	.docs-layout {
		height: 100dvh;
		overflow-y: auto;
		overflow-x: hidden;
		scroll-behavior: smooth;
		scroll-padding-top: 80px;
	}

	/* ── Main Content ──────────────────────────────────── */
	.docs-main {
		padding: 88px 48px 120px;
		max-width: 1100px;
		margin: 0 auto;
		font-family: var(--font-serif);
		font-size: 16.5px;
		line-height: 1.72;
		color: var(--text);
	}

	.page-section { margin-bottom: 72px; padding-top: 8px; }

	/* ── Typography ────────────────────────────────────── */
	.docs-main h1 {
		font-family: var(--font-mono-alt);
		font-size: 36px;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.03em;
		margin-bottom: 12px;
		line-height: 1.2;
	}

	.docs-main h2 {
		font-family: var(--font-mono-alt);
		font-size: 20px;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.02em;
		margin-bottom: 16px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--border);
	}

	.docs-main h3 {
		font-family: var(--font-mono-alt);
		font-size: 15px;
		font-weight: 500;
		color: var(--text);
		margin-bottom: 10px;
		margin-top: 28px;
	}

	.docs-main h3:first-child { margin-top: 0; }
	.docs-main p { margin-bottom: 14px; }
	.docs-main a { color: oklch(0.7 0.12 240); text-decoration: none; }
	.docs-main a:hover { text-decoration: underline; }
	.docs-main strong { color: var(--text); font-weight: 600; }

	/* ── Hero ──────────────────────────────────────────── */
	.docs-hero {
		margin-bottom: 56px;
		padding-bottom: 40px;
		border-bottom: 1px solid var(--border);
		text-align: center;
	}

	.hero-tagline {
		font-family: var(--font-serif);
		font-size: 18px;
		color: var(--text-muted);
		font-style: italic;
		margin-bottom: 20px;
	}

	.hero-lead {
		font-size: 18px;
		line-height: 1.65;
		margin-bottom: 0;
		max-width: 640px;
		margin-left: auto;
		margin-right: auto;
	}

	/* ── Pricing Cards ────────────────────────────────── */
	.pricing-cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		margin-bottom: 72px;
	}

	.plan-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 28px 24px;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.plan-card.featured {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent), 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	.plan-badge {
		position: absolute;
		top: -11px;
		left: 50%;
		transform: translateX(-50%);
		font-family: var(--font-mono-alt);
		font-size: 10.5px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--bg);
		background: var(--accent);
		padding: 3px 12px;
		border-radius: 4px;
		white-space: nowrap;
	}

	.plan-header {
		text-align: center;
		margin-bottom: 24px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--border);
	}

	.plan-icon {
		width: 44px;
		height: 44px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 14px;
	}

	.plan-icon.free {
		background: oklch(0.7 0.12 240 / 0.12);
		color: oklch(0.7 0.12 240);
	}

	.plan-icon.pro {
		background: oklch(0.75 0.15 65 / 0.12);
		color: var(--accent);
	}

	.plan-icon.gov {
		background: oklch(0.6 0.05 280 / 0.12);
		color: oklch(0.7 0.08 280);
	}

	.plan-name {
		font-family: var(--font-mono-alt);
		font-size: 18px;
		font-weight: 500;
		color: var(--text);
		margin-bottom: 8px;
		border: none;
		padding: 0;
	}

	.plan-price {
		margin-bottom: 8px;
	}

	.price-amount {
		font-family: var(--font-mono-alt);
		font-size: 32px;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.03em;
	}

	.price-period {
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--text-muted);
	}

	.plan-desc {
		font-size: 14px;
		color: var(--text-muted);
		margin: 0;
	}

	/* ── Plan Features ────────────────────────────────── */
	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0 0 24px;
		flex: 1;
	}

	.plan-features li {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--text);
		padding: 6px 0;
		border-bottom: 1px solid oklch(0.3 0 0 / 0.15);
		line-height: 1.4;
	}

	.plan-features li:last-child { border-bottom: none; }

	.plan-features-group {
		font-family: var(--font-mono-alt);
		font-size: 10px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		padding: 8px 0 2px;
		border-bottom: none;
	}

	:global(.feat-yes) { color: var(--success); flex-shrink: 0; }
	:global(.feat-no) { color: var(--text-muted); opacity: 0.4; flex-shrink: 0; }

	/* ── CTA Buttons ──────────────────────────────────── */
	.plan-cta { text-align: center; }

	.btn-plan {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 10px 20px;
		border-radius: 8px;
		font-family: var(--font-mono-alt);
		font-size: 13.5px;
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s;
		letter-spacing: 0.02em;
	}

	.btn-free {
		background: var(--bg);
		border: 1px solid var(--border);
		color: var(--text);
	}

	.btn-free:hover { background: var(--bg-elevated); }

	.btn-pro {
		background: var(--accent);
		border: 1px solid var(--accent);
		color: var(--bg);
	}

	.btn-pro:hover { opacity: 0.9; }

	.btn-gov {
		background: var(--bg);
		border: 1px solid var(--border);
		color: var(--text);
	}

	.btn-gov:hover { background: var(--bg-elevated); }

	/* ── Tables ────────────────────────────────────────── */
	.table-wrap {
		overflow-x: auto;
		margin-bottom: 20px;
		border-radius: 8px;
		border: 1px solid var(--border);
	}

	.docs-main table { width: 100%; border-collapse: collapse; font-size: 14px; }

	.docs-main thead th {
		font-family: var(--font-mono-alt);
		font-size: 11.5px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		text-align: left;
		padding: 10px 16px;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	.docs-main tbody td {
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}

	.docs-main tbody tr:last-child td { border-bottom: none; }

	.table-group td {
		font-family: var(--font-mono-alt);
		font-size: 11.5px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		background: oklch(0.75 0.15 65 / 0.06);
		padding: 8px 16px;
	}

	/* ── Code ──────────────────────────────────────────── */
	.docs-main code {
		font-family: var(--font-mono-alt);
		font-size: 13.5px;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		padding: 1px 6px;
		border-radius: 4px;
		color: var(--accent);
	}

	/* ── Callouts ──────────────────────────────────────── */
	.callout {
		border-radius: 8px;
		padding: 14px 18px;
		margin-bottom: 20px;
		font-size: 15px;
	}

	.callout-info {
		background: oklch(0.7 0.12 240 / 0.08);
		border: 1px solid oklch(0.7 0.12 240 / 0.2);
	}

	.callout-label {
		font-family: var(--font-mono-alt);
		font-size: 11.5px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		display: block;
		margin-bottom: 4px;
		color: oklch(0.7 0.12 240);
	}

	/* ── Responsive ────────────────────────────────────── */
	@media (max-width: 860px) {
		.docs-main {
			padding: 80px 20px 100px;
		}

		.pricing-cards {
			grid-template-columns: 1fr;
			gap: 16px;
		}

		.plan-card.featured {
			order: -1;
		}
	}

	@media (min-width: 861px) and (max-width: 1024px) {
		.pricing-cards {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
