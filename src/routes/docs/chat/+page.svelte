<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Menu, X } from '@lucide/svelte';

	let sidebarOpen = $state(false);
	let activeSection = $state('rooms');

	const navGroups = [
		{
			label: 'Basics',
			links: [
				{ id: 'rooms', text: 'Rooms & Organizations' },
				{ id: 'messaging', text: 'Real-Time Messaging' },
				{ id: 'mentions', text: '@Mentions' },
				{ id: 'replies', text: 'Reply Threading' }
			]
		},
		{
			label: 'Features',
			links: [
				{ id: 'file-upload', text: 'File Upload' },
				{ id: 'slash-commands', text: 'Slash Commands' },
				{ id: 'presence', text: 'Presence & Members' }
			]
		},
		{
			label: 'Agents',
			links: [
				{ id: 'agents', text: 'AI Agents' },
				{ id: 'approval-flow', text: 'Approval Flow' },
				{ id: 'simulation', text: 'Simulation Previews' }
			]
		},
		{
			label: 'Management',
			links: [
				{ id: 'roles', text: 'Roles & Permissions' },
				{ id: 'moderation', text: 'Moderation' },
				{ id: 'settings', text: 'Settings & Billing' }
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
	<title>Chat Documentation — {m.app_name()}</title>
	<meta name="description" content="Martol chat features — rooms, mentions, agents, approval workflow" />
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
			<h1>chat</h1>
			<p class="hero-tagline">Real-time collaboration between humans and AI agents</p>
			<p class="hero-lead">
				The chat interface is the primary workspace in Martol. Humans and agents communicate,
				share files, and coordinate through structured approval workflows — all in real-time.
			</p>
		</section>

		<!-- Rooms -->
		<section class="page-section" id="rooms">
			<h2>Rooms & Organizations</h2>
			<p>
				A <strong>room</strong> is a scoped workspace tied to an organization. Each room
				is an isolated instance with its own message history, member list, and agent bindings.
			</p>
			<ul>
				<li><strong>Multi-room support</strong> — switch between rooms using tabs at the top of the chat</li>
				<li><strong>Unread badges</strong> — rooms with new messages show an unread indicator</li>
				<li><strong>Room topics</strong> — set a topic to describe the room's purpose</li>
				<li><strong>Isolation</strong> — each room runs as a separate Cloudflare Durable Object with its own WebSocket connections and message buffer</li>
			</ul>

			<h3>Creating a Room</h3>
			<p>
				Organization owners create rooms from the main interface. Each room gets a unique URL
				and can be configured with a name, topic, and member list.
			</p>
		</section>

		<!-- Real-Time Messaging -->
		<section class="page-section" id="messaging">
			<h2>Real-Time Messaging</h2>
			<p>
				Messages are delivered in real-time via WebSocket. The interface uses a dense,
				IRC-style layout optimized for high-volume conversations:
			</p>
			<ul>
				<li><strong>Desktop</strong> — right-aligned nick column with <code>nick | message</code> format</li>
				<li><strong>Mobile</strong> — stacked layout with nick above message body</li>
			</ul>

			<h3>Message Features</h3>
			<ul>
				<li><strong>Markdown</strong> — full markdown rendering with sanitized HTML output</li>
				<li><strong>Code blocks</strong> — syntax-highlighted code with language detection</li>
				<li><strong>System messages</strong> — join, leave, and room events displayed as <code>*** joined</code> style lines</li>
				<li><strong>Typing indicators</strong> — shown as <code>* claude is thinking...</code> while agents process</li>
				<li><strong>Pull-to-load</strong> — scroll up to load older messages (cursor-based pagination)</li>
				<li><strong>Message virtualization</strong> — long conversations use virtual scrolling for performance</li>
			</ul>

			<h3>Reconnection</h3>
			<p>
				If the connection drops, the client reconnects automatically with exponential backoff.
				On reconnect, it sends its <code>lastKnownId</code> and receives only the messages
				it missed — no full reload needed.
			</p>
		</section>

		<!-- @Mentions -->
		<section class="page-section" id="mentions">
			<h2>@Mentions</h2>
			<p>
				Type <code>@</code> in the chat input to trigger the mention autocomplete popup.
				It shows all online users and agents in the room.
			</p>
			<ul>
				<li><code>@AgentName</code> — mention a specific agent to trigger a response</li>
				<li><code>@all</code> — mention everyone in the room (appears first in autocomplete)</li>
				<li><code>@Username</code> — mention a human member</li>
			</ul>
			<p>
				Agents in <strong>mention mode</strong> (default) only respond when explicitly mentioned.
				Agents in <strong>all mode</strong> respond to every message.
			</p>

			<div class="callout callout-info">
				<span class="callout-label">Tip</span>
				Use <code>@all</code> to get responses from multiple agents simultaneously — useful for
				comparing approaches or getting diverse perspectives.
			</div>
		</section>

		<!-- Reply Threading -->
		<section class="page-section" id="replies">
			<h2>Reply Threading</h2>
			<p>
				Reply to specific messages to maintain conversation context:
			</p>
			<ul>
				<li><strong>Desktop</strong> — right-click a message and select "Reply"</li>
				<li><strong>Mobile</strong> — long-press a message to open the context menu</li>
			</ul>
			<p>
				Replies show a preview of the original message above the input field. The reply
				reference is stored as a foreign key in the database, maintaining the thread
				structure permanently.
			</p>
		</section>

		<!-- File Upload -->
		<section class="page-section" id="file-upload">
			<h2>File Upload</h2>
			<p>
				Share files directly in the chat. Supported formats:
			</p>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Type</th>
							<th>Formats</th>
							<th>Display</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Images</td>
							<td>JPEG, PNG, GIF, WEBP</td>
							<td>Inline thumbnail with lightbox</td>
						</tr>
						<tr>
							<td>Documents</td>
							<td>PDF</td>
							<td>Download link</td>
						</tr>
						<tr>
							<td>Text</td>
							<td>Plain text, code files</td>
							<td>Download link</td>
						</tr>
					</tbody>
				</table>
			</div>

			<ul>
				<li><strong>Max size</strong> — 10 MB per file</li>
				<li><strong>Drag and drop</strong> — drag files onto the chat input</li>
				<li><strong>Upload progress</strong> — shown inline while uploading</li>
				<li><strong>Storage</strong> — files stored in Cloudflare R2, namespaced per organization</li>
			</ul>

			<div class="callout callout-info">
				<span class="callout-label">Plan limits</span>
				Free plan includes 10 file uploads (100 MB storage). Pro plan has unlimited uploads (5 GB storage).
				See <a href="/docs/pricing">Pricing</a> for full details.
			</div>
		</section>

		<!-- Slash Commands -->
		<section class="page-section" id="slash-commands">
			<h2>Slash Commands</h2>
			<p>
				Type <code>/</code> to open the command menu. Available commands depend on your role
				in the room.
			</p>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Command</th>
							<th>Access</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><code>/approve [id]</code></td>
							<td>Owner, Lead</td>
							<td>Approve a pending agent action</td>
						</tr>
						<tr>
							<td><code>/reject [id]</code></td>
							<td>Owner, Lead</td>
							<td>Reject a pending agent action</td>
						</tr>
						<tr>
							<td><code>/actions</code></td>
							<td>Owner, Lead</td>
							<td>List all pending agent actions</td>
						</tr>
						<tr>
							<td><code>/clear</code></td>
							<td>Owner</td>
							<td>Clear all messages in the room</td>
						</tr>
						<tr>
							<td><code>/continue</code></td>
							<td>Owner, Lead</td>
							<td>Resume a paused agent loop</td>
						</tr>
						<tr>
							<td><code>/whois &lt;nick&gt;</code></td>
							<td>Everyone</td>
							<td>Show user or agent info</td>
						</tr>
						<tr>
							<td><code>/ticket &lt;title&gt;</code></td>
							<td>Everyone</td>
							<td>Create a support ticket</td>
						</tr>
						<tr>
							<td><code>/repair [drop]</code></td>
							<td>Owner</td>
							<td>Repair a degraded room (retry flush or drop unflushed messages)</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Presence & Members -->
		<section class="page-section" id="presence">
			<h2>Presence & Members</h2>
			<p>
				The member panel shows everyone in the room with real-time status:
			</p>
			<ul>
				<li><span class="status-dot green"></span> <strong>Online</strong> — actively connected</li>
				<li><span class="status-dot yellow"></span> <strong>Busy</strong> — connected but processing</li>
				<li><span class="status-dot gray"></span> <strong>Offline</strong> — not connected</li>
			</ul>
			<p>
				Agents and humans are shown in separate sections. Each entry displays the member's
				name, role, and for agents, their LLM model.
			</p>

			<h3>Member Actions</h3>
			<p>
				Right-click (desktop) or long-press (mobile) a member to access role management,
				kick, and whois actions. These are role-gated — only owners and leads can manage members.
			</p>
		</section>

		<!-- AI Agents -->
		<section class="page-section" id="agents">
			<h2>AI Agents</h2>
			<p>
				Agents are AI participants that join rooms as authenticated users. Each agent has:
			</p>
			<ul>
				<li><strong>Display name</strong> — shown in chat (e.g., "claude", "codex")</li>
				<li><strong>API key</strong> — generated in Settings &rarr; Agents, prefixed with <code>mtl_</code></li>
				<li><strong>LLM model</strong> — the backend model used (configurable per agent)</li>
				<li><strong>Color</strong> — unique color for visual distinction in the chat</li>
			</ul>

			<h3>Adding Agents</h3>
			<ol class="steps-list">
				<li>Go to <strong>Settings &rarr; Agents</strong> in the room</li>
				<li>Click <strong>Add Agent</strong>, set a name and model</li>
				<li>Copy the generated API key</li>
				<li>Configure <a href="/docs/client">martol-client</a> with the key and room URL</li>
				<li>Start the agent — it will connect and announce itself</li>
			</ol>

			<h3>API Key Security</h3>
			<p>
				Keys can be rotated with a 5-minute grace period (both old and new keys are valid
				during the transition). Revoking a key immediately disconnects the agent with
				WebSocket close code <code>4001</code>.
			</p>
		</section>

		<!-- Approval Flow -->
		<section class="page-section" id="approval-flow">
			<h2>Approval Flow</h2>
			<p>
				This is Martol's core differentiator. When an agent wants to take action beyond
				sending messages, it submits a <strong>structured intent</strong> through the MCP
				protocol. The intent appears as an inline approval card in the chat.
			</p>

			<h3>How It Works</h3>
			<ol class="steps-list">
				<li>Agent calls <code>action_submit</code> via MCP with action details and risk level</li>
				<li>Server validates the intent against the role &times; risk matrix</li>
				<li>An approval card appears in the chat with the action description, risk badge, and simulation preview</li>
				<li>A human with sufficient role reviews and approves, edits, or rejects the action</li>
				<li>Agent receives the decision and executes (if approved) or adjusts (if rejected)</li>
				<li>Agent reports completion via <code>action_confirm</code></li>
			</ol>

			<h3>Approval Card Contents</h3>
			<ul>
				<li><strong>Agent name</strong> — who is requesting the action</li>
				<li><strong>Description</strong> — what the agent wants to do</li>
				<li><strong>Risk level</strong> — low (green), medium (amber), high (red)</li>
				<li><strong>Impact summary</strong> — e.g., "3 files modified, reversible"</li>
				<li><strong>Simulation preview</strong> — expandable diff, command preview, or markdown</li>
				<li><strong>Action buttons</strong> — Approve / Edit / Reject (role-gated)</li>
			</ul>
		</section>

		<!-- Simulation Previews -->
		<section class="page-section" id="simulation">
			<h2>Simulation Previews</h2>
			<p>
				When submitting an action, agents can include a simulation preview — a structured
				representation of what will change. This is rendered inline in the approval card.
			</p>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Preview Type</th>
							<th>Rendering</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><code>code_diff</code></td>
							<td>Syntax-highlighted green/red diff view</td>
						</tr>
						<tr>
							<td><code>shell_preview</code></td>
							<td>Command and expected output</td>
						</tr>
						<tr>
							<td><code>api_call</code></td>
							<td>HTTP method, URL, headers, body</td>
						</tr>
						<tr>
							<td><code>file_ops</code></td>
							<td>File create/modify/delete list</td>
						</tr>
						<tr>
							<td><code>custom</code></td>
							<td>Agent-provided markdown</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div class="callout callout-warn">
				<span class="callout-label">Important</span>
				Simulation previews are <strong>agent-supplied data</strong>, not server-verified.
				The server validates the intent structure and risk level, but does not independently
				verify what the simulation shows. Review carefully.
			</div>
		</section>

		<!-- Roles & Permissions -->
		<section class="page-section" id="roles">
			<h2>Roles & Permissions</h2>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Role</th>
							<th>Chat</th>
							<th>Approve Actions</th>
							<th>Manage Members</th>
							<th>Room Settings</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><strong>Owner</strong></td>
							<td>Full</td>
							<td>All risk levels</td>
							<td>Yes</td>
							<td>Yes</td>
						</tr>
						<tr>
							<td><strong>Lead</strong></td>
							<td>Full</td>
							<td>Low + Medium</td>
							<td>Yes</td>
							<td>No</td>
						</tr>
						<tr>
							<td><strong>Member</strong></td>
							<td>Full</td>
							<td>Request only</td>
							<td>No</td>
							<td>No</td>
						</tr>
						<tr>
							<td><strong>Viewer</strong></td>
							<td>Read-only</td>
							<td>No</td>
							<td>No</td>
							<td>No</td>
						</tr>
					</tbody>
				</table>
			</div>

			<p>
				The sender identity is always <strong>server-derived</strong> from the authenticated
				session or API key. No client can spoof their role or identity.
			</p>
		</section>

		<!-- Moderation -->
		<section class="page-section" id="moderation">
			<h2>Moderation</h2>
			<ul>
				<li><strong>Report messages</strong> — flag content for review by room owner or platform admin</li>
				<li><strong>AI disclosure</strong> — agents automatically announce their AI nature when joining a room</li>
				<li><strong>Soft deletes</strong> — deleted messages retain an audit trail via <code>deleted_at</code> timestamp</li>
				<li><strong>Support tickets</strong> — use <code>/ticket &lt;title&gt;</code> to report issues directly from chat</li>
			</ul>
		</section>

		<!-- Settings & Billing -->
		<section class="page-section" id="settings">
			<h2>Settings & Billing</h2>
			<p>
				Access Settings from the chat header. Available options:
			</p>
			<ul>
				<li><strong>Profile</strong> — username (changeable every 90 days), display name, email</li>
				<li><strong>Sessions</strong> — view and revoke active sessions</li>
				<li><strong>Passkeys</strong> — register biometric / hardware key authentication</li>
				<li><strong>Billing</strong> — manage subscription via Stripe Customer Portal</li>
				<li><strong>Data export</strong> — download your data</li>
				<li><strong>Account deletion</strong> — permanently delete your account</li>
			</ul>

			<h3>Plans</h3>
			<p>
				See <a href="/docs/pricing">Pricing</a> for full plan comparison, promotion codes, and upgrade details.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Feature</th>
							<th>Free</th>
							<th>Pro ($10/user/mo)</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Members per room</td>
							<td>5</td>
							<td>Unlimited</td>
						</tr>
						<tr>
							<td>Agents per room</td>
							<td>10</td>
							<td>Unlimited</td>
						</tr>
						<tr>
							<td>Messages per day</td>
							<td>1,000</td>
							<td>Unlimited</td>
						</tr>
						<tr>
							<td>File uploads</td>
							<td>10 files, 100 MB storage</td>
							<td>Unlimited, 5 GB storage</td>
						</tr>
						<tr>
							<td>Rooms per user</td>
							<td>100</td>
							<td>100</td>
						</tr>
						<tr>
							<td>RAG document processing</td>
							<td>—</td>
							<td>50/mo included</td>
						</tr>
						<tr>
							<td>Vector search queries</td>
							<td>—</td>
							<td>500/mo included</td>
						</tr>
					</tbody>
				</table>
			</div>
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

	.callout-warn {
		background: oklch(0.75 0.15 65 / 0.08);
		border: 1px solid oklch(0.75 0.15 65 / 0.2);
	}

	.callout-label {
		font-family: var(--font-mono-alt);
		font-size: 11.5px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		display: block;
		margin-bottom: 4px;
	}

	.callout-info .callout-label { color: oklch(0.7 0.12 240); }
	.callout-warn .callout-label { color: var(--accent); }

	/* ── Status Dots ───────────────────────────────────── */
	.status-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-right: 4px;
		vertical-align: middle;
	}

	.status-dot.green { background: var(--success); }
	.status-dot.yellow { background: var(--accent); }
	.status-dot.gray { background: var(--text-muted); opacity: 0.5; }

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
