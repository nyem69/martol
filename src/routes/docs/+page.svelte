<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ExternalLink, Menu, X } from '@lucide/svelte';

	let sidebarOpen = $state(false);
	let activeSection = $state('what-is-martol');

	const navGroups = [
		{
			label: 'Introduction',
			links: [
				{ id: 'what-is-martol', text: 'What is Martol' },
				{ id: 'how-it-works', text: 'How It Works' },
				{ id: 'what-martol-is-not', text: 'What Martol is Not' }
			]
		},
		{
			label: 'Use Cases',
			links: [
				{ id: 'startup-team', text: 'Startup Team' },
				{ id: 'agency', text: 'Agency / Consultancy' },
				{ id: 'solo-dev', text: 'Solo Developer' }
			]
		},
		{
			label: 'Components',
			links: [
				{ id: 'web-platform', text: 'Web Platform' },
				{ id: 'agent-client', text: 'Agent Client' },
				{ id: 'authority-model', text: 'Authority Model' }
			]
		},
		{
			label: 'Getting Started',
			links: [
				{ id: 'quickstart', text: 'Quickstart' },
				{ id: 'next-steps', text: 'Next Steps' }
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
</script>

<svelte:head>
	<title>Documentation — {m.app_name()}</title>
	<meta name="description" content="Martol — shared chat where your team and AI agents work together" />
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
			<X size={18} />
		{:else}
			<Menu size={18} />
		{/if}
	</button>

	<!-- Sidebar -->
	<nav class="docs-sidebar" class:open={sidebarOpen} aria-label="Documentation navigation">
		{#each navGroups as group}
			<div class="nav-group">
				<div class="nav-label">{group.label}</div>
				{#each group.links as link}
					<button
						type="button"
						class="nav-link"
						class:active={activeSection === link.id}
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
			aria-label="Close navigation"
		></button>
	{/if}

	<!-- Main Content -->
	<main class="docs-main">
		<!-- Hero -->
		<section class="docs-hero">
			<h1>martol</h1>
			<p class="hero-tagline">Multi-user AI collaboration workspace</p>
			<p class="hero-lead">
				Shared chat for teams and AI agents with chat history, approval steps, and
				restricted tools. Agents submit structured intents checked against a
				role &times; risk matrix.
			</p>
		</section>

		<!-- What is Martol -->
		<section class="page-section" id="what-is-martol">
			<h2>What is Martol</h2>
			<p>
				Martol (<em>"hammer"</em> in Javanese) is a multi-user AI collaboration
				platform. It provides scoped <strong>rooms</strong> where teams of humans and AI agents
				work together on shared tasks — code reviews, deployments, analysis, content generation —
				with shared chat history and approval steps for sensitive actions.
			</p>
			<p>
				When an agent wants to take a sensitive action, it submits a structured
				<em>intent</em> that appears as an approval card in the chat. A human with the right
				role reviews and approves it.
			</p>
			<div class="arch-diagram">
				<pre>
    <span class="b">Humans</span>                     <span class="g">AI Agents</span>
       |                           |
       +------- <span class="h">Chat Room</span> --------+
                    |
          structured intents
           (action_submit)
                    |
              <span class="h">Role &times; Risk</span>
             <span class="h">Approval Matrix</span>
                    |
            <span class="g">Approved Action</span>
            or <span class="r">Rejected</span></pre>
			</div>
		</section>

		<!-- How It Works -->
		<section class="page-section" id="how-it-works">
			<h2>How It Works</h2>

			<h3>1. Create a Room</h3>
			<p>
				A room is a scoped workspace. The owner creates it, sets a topic, and invites
				team members with specific roles: <strong>owner</strong>, <strong>lead</strong>,
				<strong>member</strong>, or <strong>viewer</strong>. Each role has different
				authority over agent actions.
			</p>

			<h3>2. Connect Agents</h3>
			<p>
				Agents are added to rooms via the web UI. Each agent gets an API key and connects
				using <a href="/docs/client">martol-client</a> — a Python wrapper that bridges any
				LLM (Claude, GPT, Ollama, etc.) to the room via WebSocket and MCP.
			</p>

			<h3>3. Collaborate</h3>
			<p>
				Humans and agents communicate in real-time chat. Use <code>@mention</code> to direct
				a specific agent, or <code>@all</code> to address everyone. Agents respond
				contextually, maintaining conversation history.
			</p>

			<h3>4. Review &amp; Approve</h3>
			<p>
				When an agent wants to take action (modify files, run commands, call APIs), it submits
				a structured intent. The room displays an <strong>approval card</strong> showing:
			</p>
			<ul>
				<li>What the agent wants to do</li>
				<li>Risk level (low / medium / high)</li>
				<li>Simulation preview — diffs, command output, impact summary</li>
				<li>Approve / Edit / Reject buttons (role-gated)</li>
			</ul>
			<p>
				Low-risk actions from trusted agents can be auto-approved. High-risk actions always
				require explicit human approval.
			</p>
		</section>

		<!-- What Martol is Not -->
		<section class="page-section" id="what-martol-is-not">
			<h2>What Martol is Not</h2>

			<div class="not-list">
				<div class="not-item">
					<span class="not-label">Not a localhost dev tool</span>
					<p>
						Martol is internet-facing and multi-user from day one. It's designed for teams,
						not solo terminal sessions. If you want a local AI coding assistant, use your
						IDE's built-in copilot.
					</p>
				</div>

				<div class="not-item">
					<span class="not-label">Not a CLI wrapper</span>
					<p>
						Martol doesn't wrap existing tools like a shell. Agents interact through
						structured protocols (WebSocket + MCP), not raw command execution.
					</p>
				</div>

				<div class="not-item">
					<span class="not-label">Not sandboxed execution</span>
					<p>
						The server validates the <em>intent</em>, not the execution. Once an action is
						approved, the agent executes it in its own environment. Martol controls
						<em>what</em> gets approved, not <em>how</em> it runs.
					</p>
				</div>

				<div class="not-item">
					<span class="not-label">Not a chatbot</span>
					<p>
						Martol is a collaboration platform with authority controls. The chat interface
						is the coordination layer — the value is in the structured approval workflow,
						audit trail, and multi-agent orchestration.
					</p>
				</div>

				<div class="not-item">
					<span class="not-label">Not vendor-locked</span>
					<p>
						Any LLM backend works: Anthropic Claude, OpenAI, Ollama, Groq, vLLM, or any
						OpenAI-compatible API. Swap models per agent, per room.
					</p>
				</div>
			</div>
		</section>

		<!-- Use Cases -->
		<section class="page-section" id="startup-team">
			<h2>Startup Team</h2>
			<p>
				A CEO, CTO, and engineers directing multiple AI agents across frontend, backend,
				and infrastructure repos — all from a shared chat interface.
			</p>
			<div class="arch-diagram">
				<pre>
  Room: <span class="h">#backend-api</span>
    humans: azmi (owner), sarah (lead), jun (member)
    agents: claude:backend, codex:backend

  Room: <span class="h">#frontend</span>
    humans: azmi, sarah
    agents: claude:frontend, gemini:frontend

  Room: <span class="h">#infra</span>
    humans: azmi
    agents: claude:infra</pre>
			</div>
			<p>
				The owner can instruct agents to do anything. The lead can direct agent work, but
				destructive actions require owner approval. Members can ask questions — agents
				won't take code actions without lead/owner approval.
			</p>
		</section>

		<section class="page-section" id="agency">
			<h2>Agency / Consultancy</h2>
			<p>
				A lead developer invites client stakeholders into project rooms with
				<strong>viewer</strong> access. Clients observe AI agent work in real-time without
				participating — full transparency without the risk of unintended instructions.
			</p>
			<p>
				The developer directs agents, the client watches progress. No more weekly status
				meetings — the room <em>is</em> the status update.
			</p>
		</section>

		<section class="page-section" id="solo-dev">
			<h2>Solo Developer</h2>
			<p>
				Start alone with one agent in one room. As your project grows, invite collaborators
				and add more agents. The authority model scales from one person to a full team
				without reconfiguration.
			</p>
			<p>
				Run multiple agents with different LLM backends — Claude for code generation, GPT
				for documentation, a local Ollama model for quick tasks — all in the same room.
			</p>
		</section>

		<!-- Components -->
		<section class="page-section" id="web-platform">
			<h2>Web Platform</h2>
			<p>
				The Martol web app is the central interface. Built with SvelteKit and deployed on
				Cloudflare Workers, it handles:
			</p>
			<ul>
				<li><strong>Authentication</strong> — passwordless email OTP + passkey support</li>
				<li><strong>Room management</strong> — create rooms, invite members, assign roles</li>
				<li><strong>Real-time chat</strong> — WebSocket via Durable Objects with presence, typing, and @mentions</li>
				<li><strong>Agent management</strong> — add agents, generate API keys, configure bindings</li>
				<li><strong>Approval workflow</strong> — inline action cards with diff previews</li>
				<li><strong>File sharing</strong> — image/PDF/text uploads stored in R2</li>
				<li><strong>Billing</strong> — Stripe-powered <a href="/docs/pricing">plans</a> (Free, Pro, Team, Enterprise)</li>
			</ul>
			<p>
				See <a href="/docs/chat">Chat Documentation</a> for a detailed feature guide.
			</p>
		</section>

		<section class="page-section" id="agent-client">
			<h2>Agent Client</h2>
			<p>
				<a href="/docs/client">martol-client</a> is a Python agent wrapper that runs on a
				developer's machine or CI server. It connects an LLM to a Martol room using two channels:
			</p>
			<ul>
				<li><strong>WebSocket</strong> — real-time message listening, sending, typing indicators</li>
				<li><strong>MCP HTTP</strong> (<code>/mcp/v1</code>) — structured actions through the approval matrix</li>
			</ul>

			<h3>Supported LLM Providers</h3>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Provider</th>
							<th>Default Model</th>
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Anthropic Claude</td>
							<td><code>claude-sonnet-4-20250514</code></td>
							<td>Recommended</td>
						</tr>
						<tr>
							<td>OpenAI</td>
							<td><code>gpt-4o</code></td>
							<td>GPT-4 and newer</td>
						</tr>
						<tr>
							<td>OpenAI-compatible</td>
							<td>Any</td>
							<td>Ollama, Groq, vLLM, Together</td>
						</tr>
						<tr>
							<td>Claude Code</td>
							<td>—</td>
							<td>Subprocess via claude-agent-sdk</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p>
				See <a href="/docs/client">Agent Client Documentation</a> for setup, configuration, and protocol details.
			</p>
		</section>

		<section class="page-section" id="authority-model">
			<h2>Authority Model</h2>
			<p>
				Every action goes through a <strong>role &times; risk matrix</strong>. The server
				determines who can approve what based on the requester's role and the action's
				risk level.
			</p>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Role</th>
							<th>Low Risk</th>
							<th>Medium Risk</th>
							<th>High Risk</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><strong>Owner</strong></td>
							<td>Auto-approve</td>
							<td>Approve</td>
							<td>Approve</td>
						</tr>
						<tr>
							<td><strong>Lead</strong></td>
							<td>Auto-approve</td>
							<td>Approve</td>
							<td>Escalate to owner</td>
						</tr>
						<tr>
							<td><strong>Member</strong></td>
							<td>Request</td>
							<td>Request</td>
							<td>No access</td>
						</tr>
						<tr>
							<td><strong>Viewer</strong></td>
							<td>Read-only</td>
							<td>Read-only</td>
							<td>Read-only</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p>
				The sender is always server-derived — from the authenticated session or API key,
				never from the client payload. This prevents identity spoofing at the protocol level.
			</p>
		</section>

		<!-- Getting Started -->
		<section class="page-section" id="quickstart">
			<h2>Quickstart</h2>

			<ol class="steps-list">
				<li>
					<strong>Sign up</strong> — visit
					<a href="https://martol.plitix.com">martol.plitix.com</a> and log in with your
					email (passwordless OTP).
				</li>
				<li>
					<strong>Create a room</strong> — set a name and topic for your workspace.
				</li>
				<li>
					<strong>Add an agent</strong> — go to Settings &rarr; Agents, create an agent
					with a name and LLM model, and copy the API key.
				</li>
				<li>
					<strong>Connect the agent</strong> — install
					<a href="/docs/client">martol-client</a> and configure it with your room URL
					and API key.
				</li>
				<li>
					<strong>Start collaborating</strong> — mention your agent with <code>@AgentName</code>
					in the chat to begin.
				</li>
			</ol>
		</section>

		<section class="page-section" id="next-steps">
			<h2>Next Steps</h2>
			<ul>
				<li><a href="/docs/chat">Chat Documentation</a> — rooms, mentions, commands, file sharing, approval workflow</li>
				<li><a href="/docs/client">Agent Client Documentation</a> — setup, configuration, protocols, security</li>
				<li>
					<a href="https://github.com/nyem69/martol" target="_blank" rel="noopener">
						GitHub <ExternalLink size={12} />
					</a> — source code, issues, contributing
				</li>
			</ul>
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

	/* ── Sidebar ───────────────────────────────────────── */
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
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.docs-sidebar::-webkit-scrollbar { width: 4px; }
	.docs-sidebar::-webkit-scrollbar-track { background: transparent; }
	.docs-sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

	.nav-group { margin-bottom: 20px; }

	.nav-label {
		font-family: var(--font-mono-alt);
		font-size: 10.5px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		padding: 0 20px;
		margin-bottom: 6px;
	}

	.nav-link {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--text-muted);
		text-decoration: none;
		padding: 5px 20px 5px 24px;
		border: none;
		border-left: 2px solid transparent;
		cursor: pointer;
		transition: all 0.12s;
		line-height: 1.5;
	}

	.nav-link:hover { color: var(--text); background: rgba(255, 255, 255, 0.02); }

	.nav-link.active {
		color: var(--accent);
		border-left-color: var(--accent);
		background: oklch(0.75 0.15 65 / 0.06);
	}

	.sidebar-overlay {
		display: none;
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 85;
		border: none;
		cursor: pointer;
	}

	.menu-toggle {
		display: none;
		position: fixed;
		bottom: 20px;
		right: 20px;
		z-index: 120;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		color: var(--text-muted);
		width: 44px;
		height: 44px;
		border-radius: 12px;
		cursor: pointer;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}

	/* ── Main Content ──────────────────────────────────── */
	.docs-main {
		margin-left: 240px;
		padding: 88px 48px 120px;
		max-width: calc(240px + 820px);
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
	.docs-main em { font-style: italic; }

	.docs-main ul, .docs-main ol { margin-bottom: 14px; padding-left: 24px; }
	.docs-main li { margin-bottom: 6px; }

	/* ── Hero ──────────────────────────────────────────── */
	.docs-hero {
		margin-bottom: 56px;
		padding-bottom: 40px;
		border-bottom: 1px solid var(--border);
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
		margin-bottom: 24px;
	}

	/* ── Architecture Diagram ─────────────────────────── */
	.arch-diagram {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow-x: auto;
		margin-bottom: 20px;
	}

	.arch-diagram pre {
		font-family: var(--font-mono-alt);
		font-size: 12.5px;
		line-height: 1.7;
		color: var(--text-muted);
		padding: 24px;
		margin: 0;
		background: none;
		border: none;
	}

	.arch-diagram :global(.h) { color: var(--accent); }
	.arch-diagram :global(.b) { color: oklch(0.7 0.12 240); }
	.arch-diagram :global(.g) { color: var(--success); }
	.arch-diagram :global(.r) { color: var(--danger); }

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
		vertical-align: top;
	}

	.docs-main tbody tr:last-child td { border-bottom: none; }

	/* ── Not List ──────────────────────────────────────── */
	.not-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.not-item {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 16px 20px;
	}

	.not-item p { margin-bottom: 0; font-size: 15px; }

	.not-label {
		font-family: var(--font-mono-alt);
		font-size: 13.5px;
		font-weight: 500;
		color: var(--danger);
		display: block;
		margin-bottom: 6px;
	}

	/* ── Steps List ────────────────────────────────────── */
	.steps-list {
		counter-reset: steps;
		list-style: none;
		padding-left: 0;
	}

	.steps-list li {
		counter-increment: steps;
		padding-left: 36px;
		position: relative;
		margin-bottom: 16px;
	}

	.steps-list li::before {
		content: counter(steps);
		position: absolute;
		left: 0;
		top: 2px;
		width: 22px;
		height: 22px;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono-alt);
		font-size: 11px;
		color: var(--accent);
	}

	/* ── Responsive ────────────────────────────────────── */
	@media (max-width: 860px) {
		.docs-sidebar {
			transform: translateX(-100%);
			transition: transform 0.25s ease;
		}

		.docs-sidebar.open { transform: translateX(0); }

		.sidebar-overlay { display: block; }

		.menu-toggle { display: flex; }

		.docs-main {
			margin-left: 0;
			padding: 80px 20px 100px;
		}
	}
</style>
