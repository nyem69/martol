<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ExternalLink, Menu, X } from '@lucide/svelte';

	let sidebarOpen = $state(false);
	let activeSection = $state('overview');

	const navGroups = [
		{
			label: 'Getting Started',
			links: [
				{ id: 'overview', text: 'Overview' },
				{ id: 'quickstart', text: 'Quickstart' },
				{ id: 'architecture', text: 'Architecture' }
			]
		},
		{
			label: 'Configuration',
			links: [
				{ id: 'configuration', text: 'Environment Variables' },
				{ id: 'profiles', text: 'Named Profiles' },
				{ id: 'authentication', text: 'Authentication' }
			]
		},
		{
			label: 'Modes',
			links: [
				{ id: 'provider-mode', text: 'Provider Mode' },
				{ id: 'claude-code-mode', text: 'Claude Code Mode' }
			]
		},
		{
			label: 'Protocols',
			links: [
				{ id: 'websocket', text: 'WebSocket Protocol' },
				{ id: 'mcp', text: 'MCP HTTP Protocol' },
				{ id: 'tools', text: 'Tools Reference' }
			]
		},
		{
			label: 'Security',
			links: [
				{ id: 'tls', text: 'TLS Enforcement' },
				{ id: 'hmac', text: 'HMAC Verification' },
				{ id: 'ssrf', text: 'SSRF & Deny-Lists' }
			]
		},
		{
			label: 'Reference',
			links: [
				{ id: 'server-api', text: 'Server API Surface' },
				{ id: 'message-types', text: 'Message Types' },
				{ id: 'providers', text: 'LLM Providers' },
				{ id: 'troubleshooting', text: 'Troubleshooting' },
				{ id: 'badge', text: 'Open in Martol Badge' }
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
	<title>Agent Client Docs — {m.app_name()}</title>
	<meta
		name="description"
		content="Connect AI agents to Martol chat rooms via WebSocket and MCP"
	/>
</svelte:head>

<div class="docs-layout" use:scrollTrack>
	<!-- Header -->
	<header class="docs-header">
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
		<a href="/" class="header-brand">
			<span class="logo-mark">m</span>
			<span class="header-title">martol-client</span>
			<span class="version-badge">v1.0</span>
		</a>
		<a
			class="gh-link"
			href="https://github.com/nyem69/martol-client"
			target="_blank"
			rel="noopener"
		>
			GitHub <ExternalLink size={12} />
		</a>
	</header>

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
			<h1>martol<span class="accent">-client</span></h1>
			<p class="hero-tagline">Connect AI agents to Martol chat rooms via WebSocket + MCP</p>
			<p class="hero-lead">
				A Python agent wrapper that bridges language models to
				<a href="https://github.com/nyem69/martol" target="_blank" rel="noopener">Martol</a>
				collaborative workspaces. Supports Anthropic Claude, OpenAI, any OpenAI-compatible API
				(Ollama, Groq, vLLM), and Claude Code as a subprocess.
			</p>
			<div class="arch-diagram">
				<pre>                      CLI / .env
                          |
               python -m martol_agent
                          |
            +--------- <span class="h">Wrapper</span> ---------+
            |                           |
      <span class="b">WebSocket</span>                     <span class="b">MCP HTTP</span>
   <span class="b">(real-time I/O)</span>               <span class="b">(/mcp/v1 tools)</span>
            |                           |
      listen / send               action_submit
      typing indicators           action_status
            |                           |
            +------- <span class="g">Martol Server</span> -----+</pre>
			</div>
		</section>

		<!-- Overview -->
		<section class="page-section" id="overview">
			<h2>Overview</h2>
			<p>
				martol-client uses a <strong>dual-channel architecture</strong> to connect AI agents to
				chat rooms:
			</p>
			<ul>
				<li>
					<strong>WebSocket</strong> — real-time message listening, sending, and typing indicators
				</li>
				<li>
					<strong>MCP HTTP</strong> (<code>/mcp/v1</code>) — structured actions that go through
					the server's role x risk approval matrix
				</li>
			</ul>
			<p>
				The agent resolves its own identity on startup via <code>chat_who</code>, seeds
				conversation context via <code>chat_resync</code>, then listens for @mentions or replies.
				When triggered, it calls the configured LLM provider and relays responses back to the chat
				room.
			</p>
			<p>
				Two operational modes are available: <strong>Provider Mode</strong> (direct LLM API calls)
				and
				<strong>Claude Code Mode</strong> (Claude Code subprocess with project access).
			</p>
		</section>

		<!-- Quickstart -->
		<section class="page-section" id="quickstart">
			<h2>Quickstart</h2>

			<h3>Prerequisites</h3>
			<ul>
				<li>Python 3.10+</li>
				<li>
					A Martol room with an agent API key (created via the Martol web UI under Settings &rarr;
					Agents)
				</li>
				<li>An LLM API key (Anthropic, OpenAI, or compatible)</li>
			</ul>

			<h3>Setup</h3>
			<ol class="steps-list">
				<li>
					<strong>Clone and install</strong>
					<pre><code>git clone https://github.com/nicazmi/martol-client.git
cd martol-client
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt</code></pre>
				</li>
				<li>
					<strong>Create your environment file</strong>
					<pre><code>cp .env.example .env
chmod 600 .env</code></pre>
				</li>
				<li>
					<strong>Configure connection</strong>
					<pre><code><span class="cmt"># .env</span>
<span class="env">MARTOL_WS_URL</span>=<span class="str">wss://martol.plitix.com/api/rooms/&lt;roomId&gt;/ws</span>
<span class="env">MARTOL_API_KEY</span>=<span class="str">mtl_your_agent_api_key</span>
<span class="env">AI_PROVIDER</span>=<span class="str">anthropic</span>
<span class="env">AI_API_KEY</span>=<span class="str">sk-ant-...</span></code></pre>
				</li>
				<li>
					<strong>Run the agent</strong>
					<pre><code>python -m martol_agent</code></pre>
				</li>
			</ol>

			<div class="callout callout-info">
				<span class="callout-label">Note</span>
				The agent announces itself on connect with an AI disclosure message. It responds when
				mentioned with <code>@AgentName</code> in the chat room.
			</div>
		</section>

		<!-- Architecture -->
		<section class="page-section" id="architecture">
			<h2>Architecture</h2>

			<h3>Startup Sequence</h3>
			<ol class="steps-list">
				<li>Parse CLI flags / load <code>.env</code> (or <code>.env.&lt;profile&gt;</code>)</li>
				<li>Warn if <code>.env</code> has overly permissive file permissions</li>
				<li>
					Create wrapper — <code>AgentWrapper</code> (provider) or
					<code>ClaudeCodeWrapper</code> (claude-code)
				</li>
				<li>Connect WebSocket with TLS validation and API key auth</li>
				<li>
					<strong>Identity resolution</strong> — call <code>chat_who</code> via MCP to resolve
					<code>agent_user_id</code>, <code>agent_name</code>, room name, and member opt-out
					preferences
				</li>
				<li>
					<strong>Context seeding</strong> — call <code>chat_resync</code> to fetch recent
					messages
				</li>
				<li>Send AI disclosure message to the room</li>
				<li>Enter WebSocket listen loop</li>
			</ol>

			<h3>Response Flow</h3>
			<div class="flow">
				<span class="flow-node">WS message</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">_should_respond()</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node flow-highlight">LLM call</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">tool loop (MCP)</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">send reply</span>
			</div>
			<p>
				The agent responds if the message is an <code>@mention</code>, a reply to the agent's own
				message, or (in <code>all</code> mode) every non-own message. Own messages are always
				ignored to prevent self-response loops.
			</p>

			<h3>Reconnection</h3>
			<p>
				On disconnect, the agent reconnects with exponential backoff:
				<code>1s &rarr; 2s &rarr; 4s &rarr; ... &rarr; 30s</code>
				(capped), up to 20 attempts. A <code>lastKnownId</code> query parameter resumes from the
				last received sequence ID. If the server returns close code <strong>4001</strong> (API key
				revoked), the agent stops permanently.
			</p>
		</section>

		<hr />

		<!-- Configuration -->
		<section class="page-section" id="configuration">
			<h2>Environment Variables</h2>
			<p>
				All options can be set via environment variables or CLI flags. CLI takes precedence.
			</p>

			<h3>Connection</h3>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Variable</th>
							<th>CLI Flag</th>
							<th>Default</th>
							<th></th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><code>MARTOL_WS_URL</code></td>
							<td><code>--url</code></td>
							<td>—</td>
							<td><span class="pill pill-required">required</span></td>
							<td>WebSocket URL for the room</td>
						</tr>
						<tr>
							<td><code>MARTOL_API_KEY</code></td>
							<td><code>--api-key</code></td>
							<td>—</td>
							<td><span class="pill pill-required">required*</span></td>
							<td>Agent API key</td>
						</tr>
						<tr>
							<td><code>MARTOL_API_KEY_FILE</code></td>
							<td><code>--api-key-file</code></td>
							<td>—</td>
							<td><span class="pill pill-optional">optional</span></td>
							<td>Path to file containing API key (preferred over env var)</td>
						</tr>
						<tr>
							<td><code>MARTOL_MCP_URL</code></td>
							<td><code>--mcp-url</code></td>
							<td>Derived</td>
							<td><span class="pill pill-optional">optional</span></td>
							<td>MCP HTTP base URL. Auto-derived from WS URL if omitted</td>
						</tr>
						<tr>
							<td><code>MARTOL_HMAC_SECRET</code></td>
							<td><code>--hmac-secret</code></td>
							<td>—</td>
							<td><span class="pill pill-optional">optional</span></td>
							<td>HMAC secret for message integrity verification</td>
						</tr>
						<tr>
							<td><code>ALLOW_UNSIGNED_MESSAGES</code></td>
							<td><code>--allow-unsigned</code></td>
							<td><code>false</code></td>
							<td><span class="pill pill-optional">optional</span></td>
							<td>Accept unsigned messages when HMAC is configured</td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>AI Provider</h3>
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>Variable</th><th>CLI Flag</th><th>Default</th><th></th><th>Description</th></tr>
					</thead>
					<tbody>
						<tr>
							<td><code>AI_PROVIDER</code></td>
							<td><code>--provider</code></td>
							<td><code>anthropic</code></td>
							<td><span class="pill pill-optional">optional</span></td>
							<td><code>anthropic</code> or <code>openai</code></td>
						</tr>
						<tr>
							<td><code>AI_API_KEY</code></td>
							<td><code>--ai-key</code></td>
							<td>—</td>
							<td><span class="pill pill-required">required*</span></td>
							<td>LLM provider API key (provider mode only)</td>
						</tr>
						<tr>
							<td><code>AI_MODEL</code></td>
							<td><code>--model</code></td>
							<td>Provider default</td>
							<td><span class="pill pill-optional">optional</span></td>
							<td>Model ID override</td>
						</tr>
						<tr>
							<td><code>AI_BASE_URL</code></td>
							<td><code>--ai-base-url</code></td>
							<td>—</td>
							<td><span class="pill pill-optional">optional</span></td>
							<td>OpenAI-compatible base URL (Ollama, Groq, vLLM)</td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>Behavior</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Variable</th><th>CLI Flag</th><th>Default</th><th>Description</th></tr></thead>
					<tbody>
						<tr>
							<td><code>CONTEXT_MESSAGES</code></td>
							<td><code>--context</code></td>
							<td><code>50</code></td>
							<td>Rolling context window size</td>
						</tr>
						<tr>
							<td><code>RESPOND_MODE</code></td>
							<td><code>--respond</code></td>
							<td><code>mention</code></td>
							<td><code>mention</code> (only @mentions) or <code>all</code></td>
						</tr>
						<tr>
							<td><code>LLM_RATE_LIMIT</code></td>
							<td><code>--rate-limit</code></td>
							<td><code>10</code></td>
							<td>Max LLM API calls per minute</td>
						</tr>
						<tr>
							<td><code>AGENT_MODE</code></td>
							<td><code>--mode</code></td>
							<td><code>provider</code></td>
							<td><code>provider</code> or <code>claude-code</code></td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>Claude Code Mode</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Variable</th><th>CLI Flag</th><th>Default</th><th>Description</th></tr></thead>
					<tbody>
						<tr>
							<td><code>CLAUDE_CODE_MODEL</code></td>
							<td><code>--claude-model</code></td>
							<td>Claude default</td>
							<td>Model override for Claude Code</td>
						</tr>
						<tr>
							<td><code>CLAUDE_CODE_PERMISSION_MODE</code></td>
							<td><code>--claude-permission-mode</code></td>
							<td><code>default</code></td>
							<td><code>default</code>, <code>acceptEdits</code>, or <code>bypassPermissions</code></td>
						</tr>
						<tr>
							<td><code>CLAUDE_CODE_ALLOWED_TOOLS</code></td>
							<td><code>--claude-allowed-tools</code></td>
							<td>Safe defaults</td>
							<td>Comma-separated whitelist of auto-approved tools</td>
						</tr>
						<tr>
							<td><code>CLAUDE_CODE_DENY_PATHS</code></td>
							<td>—</td>
							<td><code>.env*,*.key,*.pem,*.p12</code></td>
							<td>Glob patterns for blocked file paths</td>
						</tr>
						<tr>
							<td><code>CLAUDE_CODE_APPROVAL_TIMEOUT</code></td>
							<td>—</td>
							<td><code>60</code></td>
							<td>Seconds to wait for approval</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Profiles -->
		<section class="page-section" id="profiles">
			<h2>Named Profiles</h2>
			<p>
				Run multiple agents with different configurations using
				<code>--profile &lt;name&gt;</code>. This loads <code>.env.&lt;name&gt;</code> instead of
				<code>.env</code>.
			</p>
			<pre><code><span class="cmt"># Run different agents from the same directory</span>
python -m martol_agent <span class="flg">--profile</span> <span class="val">claude</span>      <span class="cmt"># loads .env.claude</span>
python -m martol_agent <span class="flg">--profile</span> <span class="val">gpt</span>         <span class="cmt"># loads .env.gpt</span>
python -m martol_agent <span class="flg">--profile</span> <span class="val">ollama</span>      <span class="cmt"># loads .env.ollama</span>
python -m martol_agent <span class="flg">--profile</span> <span class="val">claude-code</span> <span class="cmt"># loads .env.claude-code</span></code></pre>

			<h3>Example: Anthropic Claude</h3>
			<pre><code><span class="cmt"># .env.claude</span>
<span class="env">MARTOL_WS_URL</span>=<span class="str">wss://martol.plitix.com/api/rooms/&lt;roomId&gt;/ws</span>
<span class="env">MARTOL_API_KEY</span>=<span class="str">mtl_your_key</span>
<span class="env">AI_PROVIDER</span>=<span class="str">anthropic</span>
<span class="env">AI_API_KEY</span>=<span class="str">sk-ant-...</span>
<span class="env">RESPOND_MODE</span>=<span class="str">mention</span></code></pre>

			<h3>Example: Local Ollama</h3>
			<pre><code><span class="cmt"># .env.ollama</span>
<span class="env">MARTOL_WS_URL</span>=<span class="str">wss://martol.plitix.com/api/rooms/&lt;roomId&gt;/ws</span>
<span class="env">MARTOL_API_KEY</span>=<span class="str">mtl_your_key</span>
<span class="env">AI_PROVIDER</span>=<span class="str">openai</span>
<span class="env">AI_API_KEY</span>=<span class="str">ollama</span>
<span class="env">AI_MODEL</span>=<span class="str">qwen3:14b</span>
<span class="env">AI_BASE_URL</span>=<span class="str">http://localhost:11434/v1</span></code></pre>

			<h3>Example: Claude Code</h3>
			<pre><code><span class="cmt"># .env.claude-code</span>
<span class="env">MARTOL_WS_URL</span>=<span class="str">wss://martol.plitix.com/api/rooms/&lt;roomId&gt;/ws</span>
<span class="env">MARTOL_API_KEY</span>=<span class="str">mtl_your_key</span>
<span class="env">AGENT_MODE</span>=<span class="str">claude-code</span>
<span class="env">CLAUDE_CODE_ALLOWED_TOOLS</span>=<span class="str">Read,Grep,Glob,LS</span>
<span class="env">RESPOND_MODE</span>=<span class="str">mention</span></code></pre>
		</section>

		<!-- Authentication -->
		<section class="page-section" id="authentication">
			<h2>Authentication</h2>

			<h3>Agent API Keys</h3>
			<p>
				Agents authenticate with <code>mtl_</code>-prefixed API keys created in the Martol web UI.
				Each agent is a synthetic user with the <code>agent</code> role, bound to a specific room.
			</p>

			<div class="flow">
				<span class="flow-node">x-api-key header</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">Better Auth verify</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">KV revocation check</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node flow-highlight">AgentContext</span>
			</div>

			<p>The key is sent in two places for redundancy:</p>
			<ul>
				<li>
					Query parameter: <code>?apiKey=mtl_...</code> (WebSocket connection)
				</li>
				<li>Header: <code>x-api-key: mtl_...</code> (WebSocket + MCP HTTP)</li>
			</ul>

			<div class="callout callout-warn">
				<span class="callout-label">Security</span>
				Prefer <code>--api-key-file</code> or the <code>MARTOL_API_KEY</code> environment variable
				over passing keys via <code>--api-key</code> CLI flag, which is visible in process
				listings.
			</div>

			<h3>Creating an Agent</h3>
			<p>
				In the Martol web UI, room owners and leads can create agents under
				<strong>Settings &rarr; Agents &rarr; Create Agent</strong>. This generates a synthetic
				user with role <code>agent</code> and returns a one-time-visible <code>mtl_</code> API key.
			</p>
			<p>Alternatively, use the REST API:</p>
			<pre><code><span class="kw">POST</span> /api/agents
<span class="flg">Content-Type:</span> application/json
<span class="flg">Cookie:</span> (session cookie)

&#123; <span class="str">"name"</span>: <span class="str">"my-bot"</span> &#125;

<span class="cmt"># Response:</span>
&#123;
  <span class="str">"ok"</span>: <span class="kw">true</span>,
  <span class="str">"data"</span>: &#123;
    <span class="str">"agentUserId"</span>: <span class="str">"uuid"</span>,
    <span class="str">"name"</span>: <span class="str">"my-bot"</span>,
    <span class="str">"key"</span>: <span class="str">"mtl_..."</span>
  &#125;
&#125;</code></pre>
		</section>

		<hr />

		<!-- Provider Mode -->
		<section class="page-section" id="provider-mode">
			<h2>Provider Mode</h2>
			<p>
				The default mode. Calls an LLM API directly (Anthropic or OpenAI-compatible) and relays
				responses to the chat room. Tool calls (<code>action_submit</code>/<code>action_status</code>) are executed via MCP HTTP with up to 5 iterations.
			</p>

			<h3>Anthropic Claude</h3>
			<pre><code>python -m martol_agent \
  <span class="flg">--provider</span> <span class="val">anthropic</span> \
  <span class="flg">--ai-key</span> <span class="val">sk-ant-...</span> \
  <span class="flg">--model</span> <span class="val">claude-sonnet-4-20250514</span></code></pre>

			<h3>OpenAI</h3>
			<pre><code>python -m martol_agent \
  <span class="flg">--provider</span> <span class="val">openai</span> \
  <span class="flg">--ai-key</span> <span class="val">sk-...</span> \
  <span class="flg">--model</span> <span class="val">gpt-4o</span></code></pre>

			<h3>OpenAI-Compatible (Ollama, Groq, vLLM)</h3>
			<pre><code><span class="cmt"># Local Ollama</span>
python -m martol_agent \
  <span class="flg">--provider</span> <span class="val">openai</span> \
  <span class="flg">--ai-key</span> <span class="val">ollama</span> \
  <span class="flg">--ai-base-url</span> <span class="val">http://localhost:11434/v1</span> \
  <span class="flg">--model</span> <span class="val">llama3.3</span>

<span class="cmt"># Groq</span>
python -m martol_agent \
  <span class="flg">--provider</span> <span class="val">openai</span> \
  <span class="flg">--ai-key</span> <span class="val">gsk_...</span> \
  <span class="flg">--ai-base-url</span> <span class="val">https://api.groq.com/openai/v1</span> \
  <span class="flg">--model</span> <span class="val">llama-3.3-70b-versatile</span></code></pre>

			<h3>System Prompt</h3>
			<p>
				The agent builds a system prompt containing its name, room name, member count, instructions
				for tool use, and security rules. User messages are pseudonymized
				(<code>User-1</code>, <code>User-2</code>) for privacy and wrapped in XML tags:
			</p>
			<pre><code>&lt;chat_message sender="User-1"&gt;Hey @Bot, review this PR&lt;/chat_message&gt;</code></pre>
			<p>Messages from users who opted out of AI context are excluded entirely.</p>

			<h3>Tool Loop</h3>
			<p>
				When the LLM returns tool calls, the agent executes them via MCP HTTP, feeds results back
				to the LLM, and repeats. This continues for up to <strong>5 iterations</strong>. Tool
				arguments are validated against a whitelist of known fields, and results are truncated to
				8,000 characters.
			</p>
		</section>

		<!-- Claude Code Mode -->
		<section class="page-section" id="claude-code-mode">
			<h2>Claude Code Mode</h2>
			<p>
				Bypasses the LLM provider strategy entirely. Instead, a persistent
				<a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener"
					>Claude Code</a
				>
				subprocess is managed via the Agent SDK. Chat messages become prompts; Claude Code has full
				access to the local project directory.
			</p>

			<div class="callout callout-info">
				<span class="callout-label">Prerequisite</span>
				Install the Claude Code CLI (<code>npm install -g @anthropic-ai/claude-code</code>) and the
				Python SDK (<code>pip install claude-agent-sdk</code>).
			</div>

			<pre><code><span class="cmt"># Run against a project directory</span>
cd /path/to/your/project
python -m martol_agent <span class="flg">--mode</span> <span class="val">claude-code</span> <span class="flg">--profile</span> <span class="val">claude-code</span></code></pre>

			<h3>Permission Modes</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Mode</th><th>Behavior</th></tr></thead>
					<tbody>
						<tr>
							<td><code>default</code></td>
							<td>Every tool call posted to chat room for approval via <code>action_submit</code></td>
						</tr>
						<tr>
							<td><code>acceptEdits</code></td>
							<td>File edits auto-approved; destructive operations still require approval</td>
						</tr>
						<tr>
							<td><code>bypassPermissions</code></td>
							<td>All tool calls auto-approved. Requires <code>--bypass-permissions-confirm</code></td>
						</tr>
					</tbody>
				</table>
			</div>

			<div class="callout callout-danger">
				<span class="callout-label">Warning</span>
				<code>bypassPermissions</code> grants unrestricted shell and filesystem access to chat room
				users. Only use in trusted, isolated environments.
			</div>

			<h3>Tool Whitelist</h3>
			<p>
				Default safe tools (when no whitelist specified): <code>Read</code>, <code>Grep</code>,
				<code>Glob</code>, <code>LS</code>, <code>WebSearch</code>, <code>WebFetch</code>.
				Wildcards are supported:
			</p>
			<pre><code><span class="env">CLAUDE_CODE_ALLOWED_TOOLS</span>=<span class="str">Read,Grep,Glob,LS,mcp__playwright__*</span></code></pre>

			<h3>Approval Flow</h3>
			<div class="flow">
				<span class="flow-node">Tool request</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">Deny-list check</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">SSRF check</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">Whitelist check</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node flow-highlight">action_submit</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">Poll (3s)</span>
				<span class="flow-arrow">&rarr;</span>
				<span class="flow-node">Allow / Deny</span>
			</div>
		</section>

		<hr />

		<!-- WebSocket Protocol -->
		<section class="page-section" id="websocket">
			<h2>WebSocket Protocol</h2>
			<p>
				Connect to
				<code>wss://&lt;host&gt;/api/rooms/&lt;roomId&gt;/ws?apiKey=&lt;key&gt;</code>
				with the <code>x-api-key</code> header. Messages are JSON-encoded.
			</p>

			<h3>Client &rarr; Server</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Type</th><th>Payload</th><th>Description</th></tr></thead>
					<tbody>
						<tr>
							<td><code>message</code></td>
							<td><code>&#123; body, localId, replyTo? &#125;</code></td>
							<td>Send a chat message</td>
						</tr>
						<tr>
							<td><code>typing</code></td>
							<td><code>&#123; isTyping: bool &#125;</code></td>
							<td>Typing indicator</td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>Server &rarr; Client</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Type</th><th>Payload</th><th>Description</th></tr></thead>
					<tbody>
						<tr>
							<td><code>message</code></td>
							<td><code>&#123; message: &#123; serverSeqId, sender_id, sender_name, sender_role, body, replyTo?, _hmac? &#125; &#125;</code></td>
							<td>Chat message from a room member</td>
						</tr>
						<tr>
							<td><code>history</code></td>
							<td><code>&#123; messages: [...] &#125;</code></td>
							<td>Delta sync on reconnect</td>
						</tr>
						<tr>
							<td><code>id_map</code></td>
							<td><code>&#123; localId, serverSeqId, dbId &#125;</code></td>
							<td>Maps client localId to server IDs</td>
						</tr>
						<tr>
							<td><code>typing</code></td>
							<td><code>&#123; senderId, senderName, active &#125;</code></td>
							<td>Typing indicator from other member</td>
						</tr>
						<tr>
							<td><code>presence</code></td>
							<td><code>&#123; senderId, senderName, senderRole, status &#125;</code></td>
							<td>Online/offline status change</td>
						</tr>
						<tr>
							<td><code>roster</code></td>
							<td><code>&#123; members: [&#123;id, name, role&#125;] &#125;</code></td>
							<td>Full member list update</td>
						</tr>
						<tr>
							<td><code>error</code></td>
							<td><code>&#123; code, message &#125;</code></td>
							<td>Error notification</td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>Error Codes</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Code</th><th>Meaning</th></tr></thead>
					<tbody>
						<tr><td><code>rate_limited</code></td><td>Too many messages in time window</td></tr>
						<tr><td><code>room_full</code></td><td>Room has reached capacity</td></tr>
						<tr><td><code>invalid_message</code></td><td>Malformed or oversized message</td></tr>
						<tr><td><code>unauthorized</code></td><td>Invalid or expired credentials</td></tr>
						<tr><td><code>resync_required</code></td><td>Client should re-fetch history</td></tr>
					</tbody>
				</table>
			</div>

			<h3>WebSocket Close Code 4001</h3>
			<p>
				If the server closes the WebSocket with code <strong>4001</strong>, the API key has been
				revoked. The agent stops permanently and does not attempt to reconnect.
			</p>
		</section>

		<!-- MCP Protocol -->
		<section class="page-section" id="mcp">
			<h2>MCP HTTP Protocol</h2>
			<p>
				All structured actions go through the MCP endpoint at <code>POST /mcp/v1</code>. The base
				URL is derived from the WebSocket URL (<code>wss://</code> &rarr; <code>https://</code>).
			</p>

			<h3>Request Format</h3>
			<pre><code><span class="kw">POST</span> &#123;mcp_url&#125;/mcp/v1
<span class="flg">x-api-key:</span> mtl_...
<span class="flg">Content-Type:</span> application/json

&#123;
  <span class="str">"tool"</span>: <span class="str">"chat_who"</span>,
  <span class="str">"arguments"</span>: &#123;&#125;
&#125;</code></pre>

			<h3>Response Envelope</h3>
			<pre><code><span class="cmt">// Success</span>
&#123; <span class="str">"ok"</span>: <span class="kw">true</span>, <span class="str">"data"</span>: &#123; ... &#125; &#125;

<span class="cmt">// Error</span>
&#123; <span class="str">"ok"</span>: <span class="kw">false</span>, <span class="str">"error"</span>: <span class="str">"description"</span>, <span class="str">"code"</span>: <span class="str">"error_code"</span> &#125;</code></pre>

			<p>
				Payload size limit is <strong>65,536 bytes</strong>. Requests are validated with Zod
				schemas server-side. The client enforces a <strong>30-second timeout</strong> and blocks
				redirects.
			</p>
		</section>

		<!-- Tools Reference -->
		<section class="page-section" id="tools">
			<h2>Tools Reference</h2>
			<p>
				Seven tools are available via MCP. The agent exposes two to the LLM
				(<code>action_submit</code> and <code>action_status</code>); the others are used internally
				for context management.
			</p>

			<div class="table-wrap">
				<table>
					<thead><tr><th>Tool</th><th>Arguments</th><th>Purpose</th></tr></thead>
					<tbody>
						<tr>
							<td><code>chat_who</code></td>
							<td><em>none</em></td>
							<td>Resolve agent identity, room name, member list, opt-out preferences</td>
						</tr>
						<tr>
							<td><code>chat_resync</code></td>
							<td><code>limit?</code> (1-200)</td>
							<td>Fetch last N messages (context seeding)</td>
						</tr>
						<tr>
							<td><code>chat_read</code></td>
							<td><code>limit?</code></td>
							<td>Cursor-based message reading</td>
						</tr>
						<tr>
							<td><code>chat_send</code></td>
							<td><code>body</code> (max 32KB), <code>reply_to?</code></td>
							<td>Send a message as the agent</td>
						</tr>
						<tr>
							<td><code>chat_join</code></td>
							<td><em>none</em></td>
							<td>Join room (idempotent, 1 min cooldown)</td>
						</tr>
						<tr>
							<td><code>action_submit</code></td>
							<td><code>action_type</code>, <code>risk_level</code>, <code>trigger_message_id</code>, <code>description</code>, <code>payload?</code>, <code>simulation?</code></td>
							<td>Submit action for human approval</td>
						</tr>
						<tr>
							<td><code>action_status</code></td>
							<td><code>action_id</code></td>
							<td>Poll approval status</td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>Action Types</h3>
			<p>
				<code>question_answer</code> &middot;
				<code>code_review</code> &middot;
				<code>code_write</code> &middot;
				<code>code_modify</code> &middot;
				<code>code_delete</code> &middot;
				<code>deploy</code> &middot;
				<code>config_change</code>
			</p>

			<h3>Risk Levels & Approval Matrix</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Risk</th><th>Owner</th><th>Lead</th><th>Member</th><th>Viewer</th></tr></thead>
					<tbody>
						<tr>
							<td><code>low</code></td>
							<td class="cell-approve">approve</td>
							<td class="cell-approve">approve</td>
							<td>—</td>
							<td>—</td>
						</tr>
						<tr>
							<td><code>medium</code></td>
							<td class="cell-approve">approve</td>
							<td class="cell-approve">approve</td>
							<td>—</td>
							<td>—</td>
						</tr>
						<tr>
							<td><code>high</code></td>
							<td class="cell-approve">approve</td>
							<td>—</td>
							<td>—</td>
							<td>—</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p>Agents cannot approve or reject their own actions.</p>

			<h3>Simulation Payloads</h3>
			<p>
				Actions can include optional <code>simulation</code> objects for richer approval UIs:
				<code>code_diff</code>, <code>shell_preview</code>, <code>api_call</code>,
				<code>file_ops</code>, or <code>custom</code>.
			</p>
		</section>

		<hr />

		<!-- TLS -->
		<section class="page-section" id="tls">
			<h2>TLS Enforcement</h2>
			<p>The client enforces TLS for all non-local connections:</p>
			<ul>
				<li>
					WebSocket must use <code>wss://</code> unless connecting to <code>localhost</code>,
					<code>127.0.0.1</code>, or <code>::1</code>
				</li>
				<li>MCP HTTP must use <code>https://</code> for non-local hosts</li>
				<li>Unencrypted connections to remote hosts are rejected at startup</li>
			</ul>
			<pre><code><span class="cmt"># Production (required)</span>
<span class="env">MARTOL_WS_URL</span>=<span class="str">wss://martol.plitix.com/api/rooms/&lt;id&gt;/ws</span>

<span class="cmt"># Local development (allowed)</span>
<span class="env">MARTOL_WS_URL</span>=<span class="str">ws://localhost:3000/api/rooms/&lt;id&gt;/ws</span></code></pre>
		</section>

		<!-- HMAC -->
		<section class="page-section" id="hmac">
			<h2>HMAC Verification</h2>
			<p>
				When <code>MARTOL_HMAC_SECRET</code> is set, the client verifies the integrity of every
				incoming WebSocket message using HMAC-SHA256.
			</p>
			<ol class="steps-list">
				<li>
					Extract the <code>_hmac</code> field (base64-encoded) from the message
				</li>
				<li>Reconstruct the original JSON (before <code>_hmac</code> was appended by the server)</li>
				<li>Compute HMAC-SHA256 using the shared secret</li>
				<li>Compare using constant-time comparison — reject on mismatch</li>
			</ol>
			<p>
				Messages without <code>_hmac</code> are dropped unless <code>--allow-unsigned</code> is
				set (migration mode for rolling out HMAC).
			</p>

			<div class="callout callout-info">
				<span class="callout-label">Setup</span>
				Set <code>MARTOL_HMAC_SECRET</code> to the same value as
				<code>HMAC_SIGNING_SECRET</code> on the Martol server.
			</div>
		</section>

		<!-- SSRF -->
		<section class="page-section" id="ssrf">
			<h2>SSRF & Deny-Lists</h2>

			<h3>SSRF Protection (Claude Code Mode)</h3>
			<p>
				<code>WebFetch</code> tool calls are checked against private/internal IP ranges. The
				following are blocked:
			</p>
			<ul>
				<li><code>10.0.0.0/8</code> — private</li>
				<li><code>172.16.0.0/12</code> — private</li>
				<li><code>192.168.0.0/16</code> — private</li>
				<li><code>127.0.0.0/8</code> — loopback</li>
				<li><code>169.254.0.0/16</code> — link-local (cloud metadata)</li>
				<li><code>::1</code> — IPv6 loopback</li>
			</ul>
			<p>
				Domain names (not raw IPs) pass the SSRF check and proceed to the normal approval flow.
			</p>

			<h3>Path Deny-List</h3>
			<p>
				File access tools (<code>Read</code>, <code>Write</code>, <code>Edit</code>) are checked
				against glob patterns before any approval flow:
			</p>
			<pre><code><span class="cmt"># Default deny patterns</span>
<span class="env">CLAUDE_CODE_DENY_PATHS</span>=<span class="str">.env*,*.key,*.pem,*.p12</span></code></pre>
			<p>
				Matching files are <strong>immediately denied</strong> — they never reach the chat room for
				approval.
			</p>

			<h3>Tool Argument Validation</h3>
			<p>
				In provider mode, tool arguments are validated against a whitelist of known fields per tool.
				Unknown fields are silently stripped to prevent injection:
			</p>
			<pre><code><span class="cmt"># Only these fields pass through for action_submit</span>
action_type, risk_level, description, payload, trigger_message_id</code></pre>
		</section>

		<hr />

		<!-- Server API Surface -->
		<section class="page-section" id="server-api">
			<h2>Server API Surface</h2>
			<p>
				The Martol server exposes REST endpoints for human users and MCP HTTP for agents. Below is
				the complete route map relevant to client integration.
			</p>

			<div class="table-wrap">
				<table>
					<thead><tr><th>Path</th><th>Method</th><th>Auth</th><th>Purpose</th></tr></thead>
					<tbody>
						<tr>
							<td><code>/mcp/v1</code></td>
							<td><span class="pill pill-method">POST</span></td>
							<td>API Key</td>
							<td>MCP tool dispatch (agent communication)</td>
						</tr>
						<tr>
							<td><code>/api/agents</code></td>
							<td><span class="pill pill-method">GET POST</span></td>
							<td>Session</td>
							<td>List / create agents</td>
						</tr>
						<tr>
							<td><code>/api/agents/[id]</code></td>
							<td><span class="pill pill-method">DELETE</span></td>
							<td>Session</td>
							<td>Revoke and delete agent</td>
						</tr>
						<tr>
							<td><code>/api/actions</code></td>
							<td><span class="pill pill-method">GET</span></td>
							<td>Session</td>
							<td>List pending / recent actions</td>
						</tr>
						<tr>
							<td><code>/api/actions/[id]/approve</code></td>
							<td><span class="pill pill-method">POST</span></td>
							<td>Session</td>
							<td>Approve action (role-gated)</td>
						</tr>
						<tr>
							<td><code>/api/actions/[id]/reject</code></td>
							<td><span class="pill pill-method">POST</span></td>
							<td>Session</td>
							<td>Reject action</td>
						</tr>
						<tr>
							<td><code>/api/messages</code></td>
							<td><span class="pill pill-method">GET</span></td>
							<td>Session</td>
							<td>Cursor-paginated message history</td>
						</tr>
						<tr>
							<td><code>/api/rooms/[id]/ai-opt-out</code></td>
							<td><span class="pill pill-method">PATCH</span></td>
							<td>Session</td>
							<td>Toggle AI opt-out for user</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Message Types -->
		<section class="page-section" id="message-types">
			<h2>Message Types</h2>

			<h3>WebSocket Message Payload</h3>
			<pre><code>&#123;
  <span class="str">"serverSeqId"</span>: <span class="val">12345</span>,
  <span class="str">"sender_id"</span>:   <span class="str">"uuid-of-sender"</span>,
  <span class="str">"sender_name"</span>: <span class="str">"alice"</span>,
  <span class="str">"sender_role"</span>: <span class="str">"owner"</span>,     <span class="cmt">// owner | lead | member | viewer | agent</span>
  <span class="str">"body"</span>:        <span class="str">"Hey @Bot, help me"</span>,
  <span class="str">"replyTo"</span>:     <span class="val">12340</span>,        <span class="cmt">// optional, serverSeqId of parent</span>
  <span class="str">"_hmac"</span>:       <span class="str">"base64..."</span>   <span class="cmt">// if HMAC enabled</span>
&#125;</code></pre>

			<h3>MCP chat_who Response</h3>
			<pre><code>&#123;
  <span class="str">"ok"</span>: <span class="kw">true</span>,
  <span class="str">"data"</span>: &#123;
    <span class="str">"room_name"</span>:    <span class="str">"dev-room"</span>,
    <span class="str">"self_user_id"</span>: <span class="str">"agent-uuid"</span>,
    <span class="str">"members"</span>: [
      &#123;
        <span class="str">"user_id"</span>: <span class="str">"uuid"</span>,
        <span class="str">"name"</span>:    <span class="str">"alice"</span>,
        <span class="str">"role"</span>:    <span class="str">"owner"</span>,
        <span class="str">"ai_opt_out"</span>: <span class="kw">false</span>
      &#125;
    ]
  &#125;
&#125;</code></pre>

			<h3>MCP action_submit Response</h3>
			<pre><code>&#123;
  <span class="str">"ok"</span>: <span class="kw">true</span>,
  <span class="str">"data"</span>: &#123;
    <span class="str">"action_id"</span>: <span class="val">42</span>,
    <span class="str">"status"</span>:    <span class="str">"pending"</span>,
    <span class="str">"server_risk"</span>: <span class="str">"medium"</span>  <span class="cmt">// server may override</span>
  &#125;
&#125;</code></pre>
		</section>

		<!-- Providers -->
		<section class="page-section" id="providers">
			<h2>LLM Providers</h2>

			<div class="table-wrap">
				<table>
					<thead><tr><th>Provider</th><th>Flag</th><th>Default Model</th><th>Notes</th></tr></thead>
					<tbody>
						<tr>
							<td><strong>Anthropic</strong></td>
							<td><code>--provider anthropic</code></td>
							<td><code>claude-sonnet-4-20250514</code></td>
							<td>Native Anthropic SDK</td>
						</tr>
						<tr>
							<td><strong>OpenAI</strong></td>
							<td><code>--provider openai</code></td>
							<td><code>gpt-4o</code></td>
							<td>OpenAI SDK</td>
						</tr>
						<tr>
							<td><strong>Ollama</strong></td>
							<td><code>--provider openai</code></td>
							<td>—</td>
							<td><code>--ai-base-url http://localhost:11434/v1</code></td>
						</tr>
						<tr>
							<td><strong>Groq</strong></td>
							<td><code>--provider openai</code></td>
							<td>—</td>
							<td><code>--ai-base-url https://api.groq.com/openai/v1</code></td>
						</tr>
						<tr>
							<td><strong>Together</strong></td>
							<td><code>--provider openai</code></td>
							<td>—</td>
							<td><code>--ai-base-url https://api.together.xyz/v1</code></td>
						</tr>
						<tr>
							<td><strong>vLLM</strong></td>
							<td><code>--provider openai</code></td>
							<td>—</td>
							<td><code>--ai-base-url http://localhost:8000/v1</code></td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>Adding a New Provider</h3>
			<ol class="steps-list">
				<li>Create <code>martol_agent/providers/&lt;name&gt;.py</code> implementing the <code>LLMProvider</code> ABC</li>
				<li>Implement <code>chat()</code>, <code>format_tool_result()</code>, and <code>format_assistant_message()</code></li>
				<li>Register in <code>create_provider()</code> factory in <code>providers/__init__.py</code></li>
				<li>Add the choice to <code>--provider</code> argparse in <code>wrapper.py</code></li>
				<li>Handle the new provider in <code>_build_tool_result_messages()</code></li>
			</ol>
		</section>

		<!-- Troubleshooting -->
		<section class="page-section" id="troubleshooting">
			<h2>Troubleshooting</h2>

			<h3>Connection Issues</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
					<tbody>
						<tr>
							<td>"API key revoked (4001)"</td>
							<td>Agent was deleted in the Martol UI</td>
							<td>Create a new agent and update the API key</td>
						</tr>
						<tr>
							<td>"WebSocket URL must use wss://"</td>
							<td>TLS enforcement for remote hosts</td>
							<td>Use <code>wss://</code> in production</td>
						</tr>
						<tr>
							<td>"Cannot resolve agent identity"</td>
							<td><code>chat_who</code> failed</td>
							<td>Check API key and network connectivity</td>
						</tr>
						<tr>
							<td>Reconnecting in loop</td>
							<td>Network instability</td>
							<td>Check server status; agent auto-reconnects up to 20 times</td>
						</tr>
						<tr>
							<td>"HMAC verification failed"</td>
							<td>Secret mismatch</td>
							<td>Ensure <code>MARTOL_HMAC_SECRET</code> matches server's <code>HMAC_SIGNING_SECRET</code></td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>Agent Not Responding</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
					<tbody>
						<tr>
							<td>Ignores messages</td>
							<td><code>respond_mode=mention</code> and not mentioned</td>
							<td>Use <code>@AgentName</code> or set <code>--respond all</code></td>
						</tr>
						<tr>
							<td>"LLM rate limit exceeded"</td>
							<td>Too many requests per minute</td>
							<td>Increase <code>--rate-limit</code> or wait</td>
						</tr>
						<tr>
							<td>Empty responses</td>
							<td>LLM error (logged but swallowed)</td>
							<td>Check logs for "LLM call failed" errors</td>
						</tr>
						<tr>
							<td>User messages missing from context</td>
							<td>User opted out of AI</td>
							<td>User can re-enable via room settings</td>
						</tr>
					</tbody>
				</table>
			</div>

			<h3>Claude Code Mode</h3>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
					<tbody>
						<tr>
							<td>"claude-agent-sdk required"</td>
							<td>Missing dependency</td>
							<td><code>pip install claude-agent-sdk</code></td>
						</tr>
						<tr>
							<td>Tools always denied</td>
							<td>Not in whitelist</td>
							<td>Add tools to <code>CLAUDE_CODE_ALLOWED_TOOLS</code></td>
						</tr>
						<tr>
							<td>"Access to '.env' is restricted"</td>
							<td>Path deny-list match</td>
							<td>By design — sensitive files are always blocked</td>
						</tr>
						<tr>
							<td>"WebFetch blocked: private IP"</td>
							<td>SSRF protection</td>
							<td>By design — use public URLs only</td>
						</tr>
						<tr>
							<td>Approval timeout</td>
							<td>No room member approved in time</td>
							<td>Increase <code>CLAUDE_CODE_APPROVAL_TIMEOUT</code> or approve faster</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Badge -->
		<section class="page-section" id="badge">
			<h2>Open in Martol Badge</h2>
			<p>
				Add a badge to your GitHub README so collaborators can open your repo in Martol with one click.
			</p>

			<h3>Preview</h3>
			<p>
				<img src="/badge/open-in-martol.svg" alt="Open in Martol" style="height: 28px;" />
			</p>

			<h3>Markdown</h3>
			<pre><code>[![Open in Martol](https://martol.plitix.com/badge/open-in-martol.svg)](https://martol.plitix.com/open?repo=OWNER/REPO)</code></pre>

			<h3>HTML</h3>
			<pre><code>&lt;a href="https://martol.plitix.com/open?repo=OWNER/REPO"&gt;
  &lt;img src="https://martol.plitix.com/badge/open-in-martol.svg" alt="Open in Martol" /&gt;
&lt;/a&gt;</code></pre>

			<div class="callout callout-info">
				<strong>How it works:</strong> Replace <code>OWNER/REPO</code> with your GitHub repository
				(e.g. <code>nyem69/martol-client</code>). Clicking the badge creates a Martol room for
				your repo, generates an agent API key, and shows connection instructions.
			</div>
		</section>

		<!-- Footer -->
		<footer class="docs-footer">
			<div class="footer-inner">
				<a href="/" class="footer-logo">MARTOL</a>
				<nav class="footer-links" aria-label="Footer links">
					<a href="https://github.com/nyem69/martol-client" target="_blank" rel="noopener">GitHub</a>
					<a href="/security">Security</a>
					<a href="/chat">Chat</a>
				</nav>
				<p class="footer-copy">&copy; 2026 nyem &middot; AGPL-3.0</p>
			</div>
		</footer>
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

	/* ── Header ────────────────────────────────────────── */
	.docs-header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		background: rgba(8, 9, 10, 0.88);
		backdrop-filter: blur(16px) saturate(1.4);
		-webkit-backdrop-filter: blur(16px) saturate(1.4);
		border-bottom: 1px solid var(--border);
		z-index: 100;
		display: flex;
		align-items: center;
		padding: 0 24px;
		gap: 12px;
	}

	.header-brand {
		display: flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
	}

	.logo-mark {
		width: 22px;
		height: 22px;
		background: linear-gradient(135deg, var(--accent), var(--accent-muted));
		border-radius: 5px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono-alt);
		font-size: 12px;
		font-weight: 500;
		color: var(--bg);
	}

	.header-title {
		font-family: var(--font-mono-alt);
		font-size: 15px;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.02em;
	}

	.version-badge {
		font-family: var(--font-mono-alt);
		font-size: 11px;
		color: var(--text-muted);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: 4px;
	}

	.gh-link {
		margin-left: auto;
		color: var(--text-muted);
		text-decoration: none;
		font-family: var(--font-mono-alt);
		font-size: 13px;
		display: flex;
		align-items: center;
		gap: 4px;
		transition: color 0.15s;
	}

	.gh-link:hover {
		color: var(--text);
	}

	.menu-toggle {
		display: none;
		background: none;
		border: 1px solid var(--border);
		color: var(--text-muted);
		width: 36px;
		height: 36px;
		border-radius: 6px;
		cursor: pointer;
		align-items: center;
		justify-content: center;
	}

	/* ── Sidebar ───────────────────────────────────────── */
	.docs-sidebar {
		position: fixed;
		top: 56px;
		left: 0;
		width: 272px;
		height: calc(100vh - 56px);
		overflow-y: auto;
		background: var(--bg-surface);
		border-right: 1px solid var(--border);
		padding: 20px 0;
		z-index: 90;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.docs-sidebar::-webkit-scrollbar {
		width: 4px;
	}
	.docs-sidebar::-webkit-scrollbar-track {
		background: transparent;
	}
	.docs-sidebar::-webkit-scrollbar-thumb {
		background: var(--border);
		border-radius: 2px;
	}

	.nav-group {
		margin-bottom: 20px;
	}

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

	.nav-link:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.02);
	}

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

	/* ── Main Content ──────────────────────────────────── */
	.docs-main {
		margin-left: 272px;
		padding: 96px 48px 120px;
		max-width: calc(272px + 820px);
		font-family: var(--font-serif);
		font-size: 16.5px;
		line-height: 1.72;
		color: var(--text);
	}

	.page-section {
		margin-bottom: 72px;
		padding-top: 8px;
	}

	/* ── Typography ────────────────────────────────────── */
	.docs-main h1 {
		font-family: var(--font-mono-alt);
		font-size: 28px;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.03em;
		margin-bottom: 12px;
		line-height: 1.2;
	}

	.docs-main h1 .accent {
		color: var(--accent);
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

	.docs-main h3:first-child {
		margin-top: 0;
	}

	.docs-main p {
		margin-bottom: 14px;
	}

	.docs-main a {
		color: oklch(0.7 0.12 240);
		text-decoration: none;
	}

	.docs-main a:hover {
		text-decoration: underline;
	}

	.docs-main strong {
		color: var(--text);
		font-weight: 600;
	}

	.docs-main em {
		font-style: italic;
	}

	.docs-main ul,
	.docs-main ol {
		margin-bottom: 14px;
		padding-left: 24px;
	}

	.docs-main li {
		margin-bottom: 6px;
	}

	.docs-main hr {
		border: none;
		height: 1px;
		background: var(--border);
		margin: 48px 0;
	}

	/* ── Hero ──────────────────────────────────────────── */
	.docs-hero {
		margin-bottom: 56px;
		padding-bottom: 40px;
		border-bottom: 1px solid var(--border);
	}

	.docs-hero h1 {
		font-size: 36px;
		margin-bottom: 16px;
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

	.arch-diagram {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow-x: auto;
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

	.arch-diagram :global(.h) {
		color: var(--accent);
	}
	.arch-diagram :global(.b) {
		color: oklch(0.7 0.12 240);
	}
	.arch-diagram :global(.g) {
		color: var(--success);
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

	.docs-main pre {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 18px 20px;
		overflow-x: auto;
		margin-bottom: 20px;
	}

	.docs-main pre code {
		background: none;
		border: none;
		padding: 0;
		font-size: 13px;
		line-height: 1.65;
		color: var(--text);
	}

	/* Syntax highlighting classes */
	:global(.cmt) {
		color: var(--text-muted);
		font-style: italic;
	}
	:global(.kw) {
		color: oklch(0.7 0.15 300);
	}
	:global(.str) {
		color: var(--success);
	}
	:global(.flg) {
		color: oklch(0.7 0.12 240);
	}
	:global(.val) {
		color: var(--accent);
	}
	:global(.env) {
		color: oklch(0.78 0.12 90);
	}

	/* ── Tables ────────────────────────────────────────── */
	.table-wrap {
		overflow-x: auto;
		margin-bottom: 20px;
		border-radius: 8px;
		border: 1px solid var(--border);
	}

	.docs-main table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}

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

	.docs-main td {
		padding: 10px 16px;
		border-bottom: 1px solid var(--border-subtle);
		vertical-align: top;
	}

	.docs-main td code {
		font-size: 12.5px;
		white-space: nowrap;
	}

	.docs-main tr:last-child td {
		border-bottom: none;
	}

	.docs-main tbody tr:hover {
		background: rgba(255, 255, 255, 0.01);
	}

	.cell-approve {
		color: var(--success);
		font-weight: 500;
	}

	/* ── Pills ─────────────────────────────────────────── */
	.pill {
		font-family: var(--font-mono-alt);
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 4px;
		border: 1px solid;
		white-space: nowrap;
		display: inline-block;
		vertical-align: middle;
	}

	.pill-required {
		color: oklch(0.65 0.2 25);
		border-color: oklch(0.65 0.2 25 / 0.3);
		background: oklch(0.65 0.2 25 / 0.06);
	}

	.pill-optional {
		color: var(--text-muted);
		border-color: var(--border);
		background: var(--bg-elevated);
	}

	.pill-method {
		color: var(--success);
		border-color: oklch(0.7 0.17 145 / 0.3);
		background: oklch(0.7 0.17 145 / 0.06);
	}

	/* ── Callouts ──────────────────────────────────────── */
	.callout {
		border-radius: 8px;
		padding: 16px 20px;
		margin-bottom: 20px;
		font-size: 14.5px;
		line-height: 1.6;
		border-left: 3px solid;
	}

	.callout-label {
		font-family: var(--font-mono-alt);
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 6px;
		display: block;
	}

	.callout-info {
		background: oklch(0.7 0.12 240 / 0.06);
		border-color: oklch(0.7 0.12 240);
	}

	.callout-info .callout-label {
		color: oklch(0.7 0.12 240);
	}

	.callout-warn {
		background: oklch(0.78 0.12 90 / 0.06);
		border-color: oklch(0.78 0.12 90);
	}

	.callout-warn .callout-label {
		color: oklch(0.78 0.12 90);
	}

	.callout-danger {
		background: oklch(0.65 0.2 25 / 0.06);
		border-color: oklch(0.65 0.2 25);
	}

	.callout-danger .callout-label {
		color: oklch(0.65 0.2 25);
	}

	/* ── Flow Diagrams ─────────────────────────────────── */
	.flow {
		display: flex;
		align-items: center;
		gap: 0;
		margin: 24px 0;
		overflow-x: auto;
		padding: 8px 0;
	}

	.flow-node {
		font-family: var(--font-mono-alt);
		font-size: 12px;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		padding: 8px 14px;
		border-radius: 6px;
		white-space: nowrap;
		color: var(--text);
		flex-shrink: 0;
	}

	.flow-highlight {
		border-color: var(--accent-muted);
		color: var(--accent);
		background: oklch(0.75 0.15 65 / 0.08);
	}

	.flow-arrow {
		font-family: var(--font-mono-alt);
		font-size: 14px;
		color: var(--text-muted);
		padding: 0 6px;
		flex-shrink: 0;
	}

	/* ── Steps List ────────────────────────────────────── */
	.steps-list {
		list-style: none;
		padding: 0;
		counter-reset: step;
	}

	.steps-list li {
		counter-increment: step;
		position: relative;
		padding-left: 40px;
		margin-bottom: 20px;
	}

	.steps-list li::before {
		content: counter(step);
		position: absolute;
		left: 0;
		top: 2px;
		font-family: var(--font-mono-alt);
		font-size: 12px;
		font-weight: 500;
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 50%;
		color: var(--accent);
	}

	/* ── Footer ────────────────────────────────────────── */
	.docs-footer {
		padding: 40px 0;
		border-top: 1px solid var(--border-subtle);
		margin-top: 40px;
	}

	.footer-inner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.footer-logo {
		font-family: var(--font-mono-alt);
		font-size: 14px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.1em;
		text-decoration: none;
	}

	.footer-links {
		display: flex;
		gap: 20px;
	}

	.footer-links a {
		font-family: var(--font-mono-alt);
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
		font-family: var(--font-mono-alt);
		font-size: 11px;
		color: oklch(0.4 0.01 260);
		margin: 8px 0 0;
	}

	/* ── Responsive ────────────────────────────────────── */
	@media (max-width: 900px) {
		.menu-toggle {
			display: flex;
		}

		.docs-sidebar {
			transform: translateX(-100%);
			transition: transform 0.25s ease;
		}

		.docs-sidebar.open {
			transform: translateX(0);
		}

		.sidebar-overlay {
			display: block;
		}

		.docs-main {
			margin-left: 0;
			padding: 84px 20px 80px;
		}

		.flow {
			flex-wrap: wrap;
			gap: 4px;
		}
	}

	@media (max-width: 640px) {
		.docs-hero h1 {
			font-size: 28px;
		}

		.gh-link {
			display: none;
		}
	}
</style>
