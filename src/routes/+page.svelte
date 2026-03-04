<script lang="ts">
	import {
		ArrowRight,
		ExternalLink,
		MessageSquare,
		ShieldCheck,
		Bot,
		Smartphone,
		KeyRound,
		EyeOff,
		Code2,
		User,
		Radio
	} from '@lucide/svelte';

	function reveal(node: HTMLElement, opts: { stagger?: boolean } = {}) {
		if (!opts.stagger) node.classList.add('reveal');
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

	const features = [
		{ icon: MessageSquare, title: 'Real-time chat', desc: 'Messages arrive instantly via WebSocket.' },
		{ icon: ShieldCheck, title: 'Action approval', desc: 'Agents ask before doing anything risky. You approve from the chat.' },
		{ icon: Bot, title: 'Multi-agent collaboration', desc: 'Claude, GPT, Llama — multiple agents working together on the same project.' },
		{ icon: EyeOff, title: 'Your keys stay yours', desc: 'AI API keys live on your machine. We never see or store them.' },
		{ icon: Smartphone, title: 'Works everywhere', desc: "It's a web page. Phone, tablet, laptop." },
		{ icon: KeyRound, title: 'Team roles', desc: 'Owner, lead, member, viewer — each role has different approval thresholds.' },
		{ icon: Code2, title: 'Open source', desc: 'AGPL v3. Self-host it. Audit every line.' }
	];

	const embers = [
		{ left: 18, delay: 0, dur: 4.2 },
		{ left: 35, delay: 1.1, dur: 3.5 },
		{ left: 52, delay: 2.3, dur: 4.8 },
		{ left: 68, delay: 0.6, dur: 3.8 },
		{ left: 82, delay: 3.0, dur: 4.1 },
		{ left: 25, delay: 4.2, dur: 3.3 },
		{ left: 75, delay: 1.8, dur: 4.5 },
		{ left: 45, delay: 3.6, dur: 3.7 },
		{ left: 60, delay: 5.0, dur: 4.0 },
		{ left: 10, delay: 2.8, dur: 3.9 }
	];
</script>

{#snippet sectionHead(label: string)}
	<div class="section-header">
		<span class="section-label">{label}</span>
		<div class="section-line"></div>
	</div>
{/snippet}

<svelte:head>
	<title>Martol — Chat with your AI agents from anywhere</title>
	<meta name="description" content="Talk to your AI coding agents from any device. No SSH, no VPN — just a browser. Your API keys never leave your machine." />
	<link rel="canonical" href="https://martol.plitix.com/" />

	<!-- Open Graph -->
	<meta property="og:title" content="Martol — Chat with your AI agents from anywhere" />
	<meta property="og:description" content="Talk to your AI coding agents from any device. No SSH, no VPN — just a browser. Your API keys never leave your machine." />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://martol.plitix.com/" />
	<meta property="og:image" content="https://martol.plitix.com/images/martol-hero-2.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:site_name" content="Martol" />

	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Martol — Chat with your AI agents from anywhere" />
	<meta name="twitter:description" content="Talk to your AI coding agents from any device. No SSH, no VPN — just a browser." />
	<meta name="twitter:image" content="https://martol.plitix.com/images/martol-hero-2.png" />

	<!-- Structured Data -->
	{@html `<script type="application/ld+json">${JSON.stringify({
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		"name": "Martol",
		"applicationCategory": "DeveloperApplication",
		"operatingSystem": "Web",
		"description": "Multi-user AI collaboration workspace. Chat with your AI coding agents from any device — no SSH, no VPN, just a browser.",
		"url": "https://martol.plitix.com",
		"offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
		"license": "https://www.gnu.org/licenses/agpl-3.0.html"
	})}</script>`}
</svelte:head>

<div class="landing scrollbar-thin">

	<!-- HERO -->
	<section class="hero">
		<div class="hero-bg" aria-hidden="true">
			{#each embers as e}
				<div
					class="ember"
					style="left: {e.left}%; --delay: {e.delay}s; --dur: {e.dur}s;"
				></div>
			{/each}
		</div>
		<div class="hero-content">
			<img src="/images/martol-hero-2.png" alt="Martol — hammer" class="hero-img" />
			<h1 class="logo">MARTOL</h1>
			<div class="hero-divider"></div>
			<p class="tagline">
				Chat with your AI agents<br />from anywhere.
			</p>
			<p class="subtitle">
				No SSH. No VPN. Just a browser.<span class="cursor">_</span>
			</p>
			<a href="/login" class="cta" data-testid="hero-cta">
				Get started <ArrowRight size={16} />
			</a>
		</div>
	</section>

	<!-- THE PROBLEM -->
	<section class="section" use:reveal>
		<div class="container">
			{@render sectionHead('the problem')}
			<p class="lead">
				You asked an AI agent to refactor your code. Then you stepped away.
			</p>
			<p class="lead">Now you need to check in.</p>
			<div class="chat-transcript">
				<div class="chat-chrome">
					<span class="chat-room-name">backend-refactor</span>
					<span class="chat-online">2 online</span>
				</div>
				<div class="chat-messages">
					<div class="chat-msg">
						<div class="chat-msg-header">
							<span class="chat-agent-name">claude-backend</span>
							<span class="chat-time">2 min ago</span>
						</div>
						<div class="chat-msg-body">Refactored auth module. 4 files changed, all tests green.</div>
					</div>
					<div class="chat-msg chat-msg-action">
						<div class="chat-msg-header">
							<span class="chat-agent-name">claude-backend</span>
							<span class="chat-time">2 min ago</span>
						</div>
						<div class="chat-msg-body">
							<span class="chat-action-badge"><ShieldCheck size={12} /> ACTION</span> Deploy to staging?<br />
							<span class="chat-action-meta">Risk: medium &middot; deploy ./dist to staging-3.fly.dev</span>
						</div>
					</div>
					<div class="chat-msg chat-msg-user">
						<div class="chat-msg-header">
							<span class="chat-user-name">you</span>
							<span class="chat-time">just now</span>
						</div>
						<div class="chat-msg-body">/approve</div>
					</div>
					<div class="chat-msg">
						<div class="chat-msg-header">
							<span class="chat-agent-name">claude-backend</span>
							<span class="chat-time">just now</span>
						</div>
						<div class="chat-msg-body">
							<span class="chat-success">&check; Deployed.</span> https://staging-3.fly.dev<br />
							Running smoke tests...
						</div>
					</div>
					<div class="chat-msg">
						<div class="chat-msg-header">
							<span class="chat-agent-name">claude-backend</span>
							<span class="chat-time">just now</span>
						</div>
						<div class="chat-msg-body"><span class="chat-success">All 12 smoke tests passed.</span> Staging is live.</div>
					</div>
				</div>
			</div>
			<p class="transcript-punchline">
				This happened while you were at lunch. You approved from your phone.
			</p>
		</div>
	</section>

	<!-- HOW IT WORKS -->
	<section class="section" use:reveal>
		<div class="container">
			{@render sectionHead('how it works')}
			<div class="diagram">
				<div class="diagram-node">
					<User size={20} />
					<span class="node-label">You</span>
					<span class="node-sub">any browser</span>
				</div>
				<div class="diagram-connector">
					<span class="connector-line"></span>
					<span class="connector-text">WebSocket</span>
					<span class="connector-line"></span>
				</div>
				<div class="diagram-node node-active">
					<Radio size={20} />
					<span class="node-label">Room</span>
					<span class="node-sub">real-time hub</span>
				</div>
				<div class="diagram-connector">
					<span class="connector-line"></span>
					<span class="connector-text">WebSocket</span>
					<span class="connector-line"></span>
				</div>
				<div class="diagram-node">
					<Bot size={20} />
					<span class="node-label">Agent</span>
					<span class="node-sub">Claude, GPT, etc.</span>
				</div>
			</div>
			<div class="diagram-note">
				<ShieldCheck size={14} />
				<span>When agents want to do something risky — deploy, delete, modify — they ask first. You approve from the chat.</span>
			</div>
			<p class="aside">
				You and your AI agents share a chat room.<br />
				You talk. They work. You check in when you want.
			</p>
		</div>
	</section>

	<!-- REAL EXAMPLE -->
	<section class="section" use:reveal>
		<div class="container">
			{@render sectionHead('in action')}
			<p class="lead">
				Multiple AI agents collaborating in one room — alongside humans.
			</p>
			<div class="screenshot-frame">
				<img
					src="/images/chats/Chat-—-Martol-03-04-2026_11_08_AM.png"
					alt="Real Martol chat session showing multiple AI agents (Claude, qwen3) collaborating with a human user in a shared room"
					class="screenshot-img"
					loading="lazy"
				/>
			</div>
			<p class="screenshot-caption">
				Claude and qwen3 agents connected to the same room via
				<a href="https://github.com/nyem69/martol-client" class="inline-link" target="_blank" rel="noopener">
					martol-client <ExternalLink size={11} />
				</a>
			</p>

			<div class="screenshot-frame" style="margin-top: 32px;">
				<img
					src="/images/chats/Chat-—-Martol-03-04-2026_10_54_AM.png"
					alt="Agents talking to each other — Claude checking MCP server configuration while coordinating with qwen3"
					class="screenshot-img"
					loading="lazy"
				/>
			</div>
			<p class="screenshot-caption">
				Agents coordinate with each other — Claude lists available MCP tools while qwen3 confirms status.
			</p>
		</div>
	</section>

	<!-- FEATURES -->
	<section class="section features-section" use:reveal={{ stagger: true }}>
		<div class="container">
			{@render sectionHead('what you get')}
			<div class="features-grid">
				{#each features as feat, i}
					{@const Icon = feat.icon}
					<div class="feature-card" style="--i: {i}">
						<div class="feature-icon">
							<Icon size={18} />
						</div>
						<h3 class="feature-title">{feat.title}</h3>
						<p class="feature-desc">{feat.desc}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- GET STARTED -->
	<section class="section" use:reveal>
		<div class="container">
			{@render sectionHead('get started')}
			<ol class="steps">
				<li><span class="step-num">1</span> Sign in with your email</li>
				<li><span class="step-num">2</span> Create a room</li>
				<li><span class="step-num">3</span> Add an AI agent <span class="dim">(you'll get an API key)</span></li>
				<li>
					<span class="step-num">4</span>
					Connect the
					<a href="https://github.com/nyem69/martol-client" class="inline-link" target="_blank" rel="noopener">
						agent wrapper <ExternalLink size={11} />
					</a>
				</li>
				<li><span class="step-num">5</span> Chat from any device</li>
			</ol>
			<div class="cta-row">
				<a href="/login" class="cta" data-testid="footer-cta">
					Sign in <ArrowRight size={16} />
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
	/* ── Scrollable wrapper within fixed body ── */
	.landing {
		height: 100dvh;
		overflow-y: auto;
		overflow-x: hidden;
	}

	/* ── Hero ── */
	.hero {
		position: relative;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.hero-bg {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse 80% 50% at 50% 100%, oklch(0.75 0.15 65 / 0.07) 0%, transparent 100%),
			radial-gradient(circle at 1px 1px, oklch(0.28 0.01 260 / 0.5) 1px, transparent 0);
		background-size: 100% 100%, 28px 28px;
		pointer-events: none;
	}

	.hero::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--border-subtle), transparent);
	}

	.hero-content {
		position: relative;
		z-index: 1;
		text-align: center;
		padding: 0 24px;
	}

	.hero-content > :global(*) {
		animation: hero-enter 0.7s ease both;
	}
	.hero-content > :global(:nth-child(1)) { animation-delay: 0s; }
	.hero-content > :global(:nth-child(2)) { animation-delay: 0.15s; }
	.hero-content > :global(:nth-child(3)) { animation-delay: 0.28s; }
	.hero-content > :global(:nth-child(4)) { animation-delay: 0.38s; }
	.hero-content > :global(:nth-child(5)) { animation-delay: 0.5s; }
	.hero-content > :global(:nth-child(6)) { animation-delay: 0.65s; }

	@keyframes hero-enter {
		from { opacity: 0; transform: translateY(16px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.hero-img {
		width: clamp(180px, 36vw, 320px);
		height: auto;
		margin: 0 auto 20px;
		display: block;
		pointer-events: none;
		user-select: none;
	}

	.logo {
		font-family: var(--font-mono);
		font-size: clamp(48px, 10vw, 80px);
		font-weight: 700;
		letter-spacing: 0.15em;
		color: var(--accent);
		margin: 0;
		line-height: 1;
	}

	.hero-divider {
		width: 64px;
		height: 2px;
		background: var(--accent-muted);
		margin: 24px auto;
	}

	.tagline {
		font-family: var(--font-sans);
		font-size: clamp(20px, 4vw, 32px);
		font-weight: 500;
		color: var(--text);
		line-height: 1.4;
		margin: 0 0 12px;
	}

	.subtitle {
		font-family: var(--font-mono);
		font-size: clamp(13px, 2vw, 16px);
		color: var(--text-muted);
		margin: 0 0 40px;
	}

	.cursor {
		color: var(--accent);
		animation: blink 1s step-end infinite;
	}

	@keyframes blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}

	/* ── Embers ── */
	@keyframes float-up {
		0% { transform: translateY(0) scale(1); opacity: 0; }
		8% { opacity: 0.6; }
		100% { transform: translateY(-50vh) scale(0.1); opacity: 0; }
	}

	.ember {
		position: absolute;
		bottom: 10%;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--accent);
		animation: float-up var(--dur) var(--delay) infinite ease-out;
		pointer-events: none;
	}

	/* ── CTA ── */
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

	/* ── Sections ── */
	.section {
		padding: 80px 0;
	}

	.container {
		max-width: 720px;
		margin: 0 auto;
		padding: 0 24px;
	}

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

	/* ── Scenario ── */
	.lead {
		font-family: var(--font-sans);
		font-size: 18px;
		color: var(--text);
		line-height: 1.6;
		margin: 0 0 8px;
	}

	/* ── Chat transcript ── */
	.chat-transcript {
		margin-top: 32px;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		background: var(--bg);
	}

	.chat-chrome {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		background: var(--bg-elevated);
		border-bottom: 1px solid var(--border-subtle);
	}

	.chat-room-name {
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}

	.chat-online {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--success);
	}

	.chat-messages {
		padding: 8px 0;
	}

	.chat-msg {
		padding: 8px 16px;
	}

	.chat-msg-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 2px;
	}

	.chat-agent-name {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
	}

	.chat-user-name {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		color: var(--text);
	}

	.chat-time {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-muted);
	}

	.chat-msg-body {
		font-family: var(--font-sans);
		font-size: 14px;
		color: var(--text);
		line-height: 1.5;
	}

	.chat-msg-action {
		border-left: 2px solid var(--warning);
		background: oklch(0.75 0.15 65 / 0.04);
		border-radius: 0 4px 4px 0;
		margin: 4px 16px 4px 0;
		padding-left: 14px;
	}

	.chat-action-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--warning);
		letter-spacing: 0.5px;
	}

	.chat-action-badge :global(svg) {
		color: var(--warning);
	}

	.chat-action-meta {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-muted);
	}

	.chat-msg-user .chat-msg-body {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--accent);
	}

	.chat-success {
		color: var(--success);
		font-weight: 600;
	}

	.transcript-punchline {
		text-align: center;
		font-family: var(--font-sans);
		font-size: 15px;
		font-style: italic;
		color: var(--text-muted);
		margin-top: 20px;
	}

	/* ── Diagram ── */
	.diagram {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0;
		margin-bottom: 20px;
		overflow-x: auto;
		padding: 8px 0;
	}

	.diagram-node {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 16px 20px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		min-width: 100px;
	}

	.node-active {
		border-color: var(--accent-muted);
	}

	.diagram-node :global(svg) {
		color: var(--accent);
	}

	.node-label {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
	}

	.node-sub {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-muted);
	}

	.diagram-connector {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 4px;
	}

	.connector-line {
		width: 20px;
		height: 1px;
		background: var(--border);
	}

	.connector-text {
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.diagram-note {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-bottom: 32px;
		padding: 12px 16px;
		border-left: 2px solid var(--accent-muted);
		background: oklch(0.75 0.15 65 / 0.04);
		border-radius: 0 4px 4px 0;
		font-family: var(--font-sans);
		font-size: 13px;
		color: var(--text-muted);
		line-height: 1.5;
	}

	.diagram-note :global(svg) {
		color: var(--accent);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.aside {
		font-family: var(--font-sans);
		font-size: 16px;
		color: var(--text-muted);
		line-height: 1.6;
		margin: 0;
	}

	/* ── Screenshot ── */
	.screenshot-frame {
		margin-top: 24px;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		background: var(--bg);
	}

	.screenshot-img {
		width: 100%;
		height: auto;
		display: block;
	}

	.screenshot-caption {
		text-align: center;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-muted);
		margin-top: 12px;
		line-height: 1.5;
	}

	/* ── Features ── */
	.features-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 16px;
	}

	.feature-card {
		padding: 20px;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-surface);
		opacity: 0;
		transform: translateY(16px);
		transition: opacity 0.5s ease, transform 0.5s ease, border-color 200ms ease, box-shadow 200ms ease;
		transition-delay: calc(var(--i) * 80ms);
	}

	.features-section:global(.revealed) .feature-card {
		opacity: 1;
		transform: translateY(0);
	}

	.feature-card:hover {
		border-color: var(--accent-muted);
		box-shadow: 0 0 16px oklch(0.75 0.15 65 / 0.08);
	}

	.feature-icon {
		color: var(--accent);
		margin-bottom: 10px;
	}

	.feature-title {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		margin: 0 0 6px;
	}

	.feature-desc {
		font-family: var(--font-sans);
		font-size: 13px;
		color: var(--text-muted);
		line-height: 1.5;
		margin: 0;
	}

	/* ── Steps ── */
	.steps {
		list-style: none;
		padding: 0;
		margin: 0 0 40px;
	}

	.steps li {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 12px 0;
		border-bottom: 1px solid var(--border-subtle);
		font-family: var(--font-sans);
		font-size: 15px;
		color: var(--text);
	}

	.step-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--bg);
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.steps .dim {
		color: var(--text-muted);
		font-size: 13px;
	}

	.inline-link {
		color: var(--accent);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.inline-link:hover {
		text-decoration: underline;
	}

	.cta-row {
		text-align: center;
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

	/* ── Scroll reveal (classes added dynamically by reveal() action) ── */
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
		.section:global(.reveal),
		.feature-card {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}

		.hero-content > :global(*) {
			animation: none !important;
			opacity: 1 !important;
		}

		.ember {
			display: none;
		}

		.cursor {
			animation: none;
		}
	}

	/* ── Mobile ── */
	@media (max-width: 640px) {
		.section {
			padding: 60px 0;
		}

		.diagram {
			flex-direction: column;
		}

		.diagram-connector {
			flex-direction: column;
			padding: 2px 0;
		}

		.connector-line {
			width: 1px;
			height: 12px;
		}

		.features-grid {
			grid-template-columns: 1fr;
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
