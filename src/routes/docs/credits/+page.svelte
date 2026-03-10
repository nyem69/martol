<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ExternalLink, Menu, X } from '@lucide/svelte';

	let sidebarOpen = $state(false);
	let activeSection = $state('overview');

	const navGroups = [
		{
			label: 'Credits',
			links: [
				{ id: 'overview', text: 'Overview' },
				{ id: 'framework', text: 'Framework' },
				{ id: 'infrastructure', text: 'Infrastructure' },
				{ id: 'document-intelligence', text: 'Document Intelligence' },
				{ id: 'auth-data', text: 'Auth & Data' },
				{ id: 'ui', text: 'UI & Frontend' },
				{ id: 'agent-client', text: 'Agent Client' },
				{ id: 'dev-tools', text: 'Dev Tools' }
			]
		},
		{
			label: 'Services',
			links: [
				{ id: 'cloud-services', text: 'Cloud Services' },
				{ id: 'ai-services', text: 'AI Services' }
			]
		},
		{
			label: 'Info',
			links: [
				{ id: 'license', text: 'License' }
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
	<title>Credits — {m.app_name()}</title>
	<meta name="description" content="Open-source libraries, tools, and services that power Martol" />
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
	<nav class="docs-sidebar" class:open={sidebarOpen} aria-label="Credits navigation">
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
			<h1>credits</h1>
			<p class="hero-tagline">Standing on the shoulders of giants</p>
			<p class="hero-lead">
				Martol is built with open-source libraries and cloud services created by talented
				individuals and teams around the world. This page acknowledges the projects that
				make Martol possible.
			</p>
		</section>

		<!-- Overview -->
		<section class="page-section" id="overview">
			<h2>Overview</h2>
			<p>
				Martol uses a combination of open-source software and managed cloud services.
				All open-source dependencies are installed via <code>npm</code> (web platform) and
				<code>pip</code> (agent client), with licenses respected as distributed.
			</p>
			<p>
				We are grateful to every contributor behind these projects. If you maintain one of the
				libraries listed here — thank you.
			</p>
		</section>

		<!-- Framework -->
		<section class="page-section" id="framework">
			<h2>Framework</h2>
			<p>
				The core web platform is built on the Svelte and SvelteKit ecosystem.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Project</th>
							<th>Purpose</th>
							<th>License</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://svelte.dev" target="_blank" rel="noopener">
									Svelte 5 <ExternalLink size={11} />
								</a>
							</td>
							<td>UI framework — runes-based reactivity, compiled components</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://svelte.dev/docs/kit" target="_blank" rel="noopener">
									SvelteKit <ExternalLink size={11} />
								</a>
							</td>
							<td>Full-stack framework — routing, SSR, API endpoints, adapters</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://vite.dev" target="_blank" rel="noopener">
									Vite <ExternalLink size={11} />
								</a>
							</td>
							<td>Build tool — dev server, HMR, production bundling</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://capacitorjs.com" target="_blank" rel="noopener">
									Capacitor <ExternalLink size={11} />
								</a>
							</td>
							<td>Native runtime — iOS and Android builds from the web codebase</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://inlang.com/m/gerre34r/library-inlang-paraglideJs" target="_blank" rel="noopener">
									Paraglide JS <ExternalLink size={11} />
								</a>
							</td>
							<td>Internationalization — compiled, tree-shakeable i18n messages</td>
							<td>Apache-2.0</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Infrastructure -->
		<section class="page-section" id="infrastructure">
			<h2>Infrastructure</h2>
			<p>
				Deployment, real-time communication, and edge computing infrastructure.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Project</th>
							<th>Purpose</th>
							<th>License</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://github.com/cloudflare/workers-sdk" target="_blank" rel="noopener">
									Wrangler <ExternalLink size={11} />
								</a>
							</td>
							<td>Cloudflare Workers CLI — local dev, deploy, Durable Objects</td>
							<td>Apache-2.0 / MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/cloudflare/workerd" target="_blank" rel="noopener">
									workerd <ExternalLink size={11} />
								</a>
							</td>
							<td>Cloudflare Workers runtime — V8-based edge execution</td>
							<td>Apache-2.0</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Document Intelligence -->
		<section class="page-section" id="document-intelligence">
			<h2>Document Intelligence</h2>
			<p>
				The RAG pipeline that powers document extraction, chunking, embedding, and semantic search.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Project</th>
							<th>Purpose</th>
							<th>License</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://github.com/nicholasgasior/kreuzberg" target="_blank" rel="noopener">
									Kreuzberg <ExternalLink size={11} />
								</a>
							</td>
							<td>Document text extraction — PDF, DOCX, XLSX, PPTX, HTML, email, archives, and OCR for images via WASM</td>
							<td>Apache-2.0</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/nicholasgasior/kreuzberg/tree/main/packages/wasm" target="_blank" rel="noopener">
									@kreuzberg/wasm <ExternalLink size={11} />
								</a>
							</td>
							<td>WASM build of Kreuzberg — runs document extraction inside Cloudflare Workers without native dependencies</td>
							<td>Apache-2.0</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/cure53/DOMPurify" target="_blank" rel="noopener">
									DOMPurify <ExternalLink size={11} />
								</a>
							</td>
							<td>HTML sanitization — XSS prevention for rendered markdown and document content</td>
							<td>Apache-2.0 / MPL-2.0</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/markedjs/marked" target="_blank" rel="noopener">
									Marked <ExternalLink size={11} />
								</a>
							</td>
							<td>Markdown parser — renders agent messages and document previews</td>
							<td>MIT</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Auth & Data -->
		<section class="page-section" id="auth-data">
			<h2>Auth & Data</h2>
			<p>
				Authentication, database access, payments, and data validation.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Project</th>
							<th>Purpose</th>
							<th>License</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://www.better-auth.com" target="_blank" rel="noopener">
									Better Auth <ExternalLink size={11} />
								</a>
							</td>
							<td>Authentication framework — email OTP, passkeys, organizations, API keys</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://orm.drizzle.team" target="_blank" rel="noopener">
									Drizzle ORM <ExternalLink size={11} />
								</a>
							</td>
							<td>TypeScript ORM — type-safe queries, schema definitions, migrations</td>
							<td>Apache-2.0</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/brianc/node-postgres" target="_blank" rel="noopener">
									node-postgres <ExternalLink size={11} />
								</a>
							</td>
							<td>PostgreSQL client — database connectivity for Node.js</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://stripe.com" target="_blank" rel="noopener">
									Stripe SDK <ExternalLink size={11} />
								</a>
							</td>
							<td>Payments — subscription billing, checkout, customer portal</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://zod.dev" target="_blank" rel="noopener">
									Zod <ExternalLink size={11} />
								</a>
							</td>
							<td>Schema validation — runtime type checking at system boundaries</td>
							<td>MIT</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- UI & Frontend -->
		<section class="page-section" id="ui">
			<h2>UI & Frontend</h2>
			<p>
				Styling, icons, and frontend utilities.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Project</th>
							<th>Purpose</th>
							<th>License</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://tailwindcss.com" target="_blank" rel="noopener">
									Tailwind CSS <ExternalLink size={11} />
								</a>
							</td>
							<td>Utility-first CSS framework</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://lucide.dev" target="_blank" rel="noopener">
									Lucide <ExternalLink size={11} />
								</a>
							</td>
							<td>Icon library — consistent, clean SVG icons throughout the UI</td>
							<td>ISC</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/dcastil/tailwind-merge" target="_blank" rel="noopener">
									tailwind-merge <ExternalLink size={11} />
								</a>
							</td>
							<td>Merge Tailwind classes without style conflicts</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/lukeed/clsx" target="_blank" rel="noopener">
									clsx <ExternalLink size={11} />
								</a>
							</td>
							<td>Conditional class name construction</td>
							<td>MIT</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Agent Client -->
		<section class="page-section" id="agent-client">
			<h2>Agent Client</h2>
			<p>
				Python libraries used by <a href="/docs/client">martol-client</a>, the agent wrapper
				that connects LLMs to Martol rooms.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Project</th>
							<th>Purpose</th>
							<th>License</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://github.com/python-websockets/websockets" target="_blank" rel="noopener">
									websockets <ExternalLink size={11} />
								</a>
							</td>
							<td>WebSocket client — real-time message transport</td>
							<td>BSD-3-Clause</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/anthropics/anthropic-sdk-python" target="_blank" rel="noopener">
									anthropic <ExternalLink size={11} />
								</a>
							</td>
							<td>Anthropic Python SDK — Claude model integration</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/openai/openai-python" target="_blank" rel="noopener">
									openai <ExternalLink size={11} />
								</a>
							</td>
							<td>OpenAI Python SDK — GPT models and compatible APIs (Ollama, Groq, vLLM)</td>
							<td>Apache-2.0</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/anthropics/claude-code-sdk-python" target="_blank" rel="noopener">
									claude-agent-sdk <ExternalLink size={11} />
								</a>
							</td>
							<td>Claude Code bridge — subprocess mode for full IDE-like agent capabilities</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://github.com/aio-libs/aiohttp" target="_blank" rel="noopener">
									aiohttp <ExternalLink size={11} />
								</a>
							</td>
							<td>Async HTTP client — MCP protocol calls</td>
							<td>Apache-2.0</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Dev Tools -->
		<section class="page-section" id="dev-tools">
			<h2>Dev Tools</h2>
			<p>
				Development, testing, and build tooling.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Project</th>
							<th>Purpose</th>
							<th>License</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://www.typescriptlang.org" target="_blank" rel="noopener">
									TypeScript <ExternalLink size={11} />
								</a>
							</td>
							<td>Type-safe JavaScript — all server and client code</td>
							<td>Apache-2.0</td>
						</tr>
						<tr>
							<td>
								<a href="https://vitest.dev" target="_blank" rel="noopener">
									Vitest <ExternalLink size={11} />
								</a>
							</td>
							<td>Test runner — unit and integration tests</td>
							<td>MIT</td>
						</tr>
						<tr>
							<td>
								<a href="https://sentry.io" target="_blank" rel="noopener">
									Sentry SDK <ExternalLink size={11} />
								</a>
							</td>
							<td>Error monitoring — crash reporting and performance tracing</td>
							<td>MIT</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- Cloud Services -->
		<section class="page-section" id="cloud-services">
			<h2>Cloud Services</h2>
			<p>
				Managed services that Martol runs on.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Service</th>
							<th>Purpose</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://workers.cloudflare.com" target="_blank" rel="noopener">
									Cloudflare Workers <ExternalLink size={11} />
								</a>
							</td>
							<td>Edge compute — API, SSR, WebSocket handling</td>
						</tr>
						<tr>
							<td>
								<a href="https://developers.cloudflare.com/durable-objects/" target="_blank" rel="noopener">
									Cloudflare Durable Objects <ExternalLink size={11} />
								</a>
							</td>
							<td>Stateful edge instances — per-room real-time coordination</td>
						</tr>
						<tr>
							<td>
								<a href="https://developers.cloudflare.com/r2/" target="_blank" rel="noopener">
									Cloudflare R2 <ExternalLink size={11} />
								</a>
							</td>
							<td>Object storage — uploaded files and documents</td>
						</tr>
						<tr>
							<td>
								<a href="https://developers.cloudflare.com/vectorize/" target="_blank" rel="noopener">
									Cloudflare Vectorize <ExternalLink size={11} />
								</a>
							</td>
							<td>Vector database — document chunk embeddings for semantic search</td>
						</tr>
						<tr>
							<td>
								<a href="https://developers.cloudflare.com/workers-ai/" target="_blank" rel="noopener">
									Cloudflare Workers AI <ExternalLink size={11} />
								</a>
							</td>
							<td>Inference — BGE-base-en-v1.5 embeddings for document indexing</td>
						</tr>
						<tr>
							<td>
								<a href="https://developers.cloudflare.com/hyperdrive/" target="_blank" rel="noopener">
									Cloudflare Hyperdrive <ExternalLink size={11} />
								</a>
							</td>
							<td>Connection pooling — accelerated PostgreSQL access from Workers</td>
						</tr>
						<tr>
							<td>
								<a href="https://developers.cloudflare.com/kv/" target="_blank" rel="noopener">
									Cloudflare KV <ExternalLink size={11} />
								</a>
							</td>
							<td>Key-value store — session cache</td>
						</tr>
						<tr>
							<td>
								<a href="https://aiven.io" target="_blank" rel="noopener">
									Aiven <ExternalLink size={11} />
								</a>
							</td>
							<td>Managed PostgreSQL — primary database</td>
						</tr>
						<tr>
							<td>
								<a href="https://resend.com" target="_blank" rel="noopener">
									Resend <ExternalLink size={11} />
								</a>
							</td>
							<td>Email delivery — OTP login codes, notifications</td>
						</tr>
						<tr>
							<td>
								<a href="https://stripe.com" target="_blank" rel="noopener">
									Stripe <ExternalLink size={11} />
								</a>
							</td>
							<td>Payments — subscription billing, checkout, webhooks</td>
						</tr>
						<tr>
							<td>
								<a href="https://sentry.io" target="_blank" rel="noopener">
									Sentry <ExternalLink size={11} />
								</a>
							</td>
							<td>Error tracking — crash reporting, performance monitoring</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- AI Services -->
		<section class="page-section" id="ai-services">
			<h2>AI Services</h2>
			<p>
				LLM providers supported by the agent client.
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Provider</th>
							<th>Usage</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<a href="https://www.anthropic.com" target="_blank" rel="noopener">
									Anthropic <ExternalLink size={11} />
								</a>
							</td>
							<td>Claude models — recommended provider, Claude Code bridge mode</td>
						</tr>
						<tr>
							<td>
								<a href="https://openai.com" target="_blank" rel="noopener">
									OpenAI <ExternalLink size={11} />
								</a>
							</td>
							<td>GPT models — direct API and Codex bridge mode</td>
						</tr>
						<tr>
							<td>
								<a href="https://ollama.com" target="_blank" rel="noopener">
									Ollama <ExternalLink size={11} />
								</a>
							</td>
							<td>Local models — self-hosted LLMs via OpenAI-compatible API</td>
						</tr>
						<tr>
							<td>
								<a href="https://groq.com" target="_blank" rel="noopener">
									Groq <ExternalLink size={11} />
								</a>
							</td>
							<td>Fast inference — OpenAI-compatible API</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- License -->
		<section class="page-section" id="license">
			<h2>License</h2>
			<p>
				Martol itself is proprietary software. The agent client
				(<a href="/docs/client">martol-client</a>) is released under the MIT license.
			</p>
			<p>
				All third-party dependencies are used in compliance with their respective licenses.
				License texts are included with each package as distributed by their package managers.
			</p>
			<p>
				If you are a maintainer of any project listed here and have concerns about attribution,
				please <a href="mailto:nyem69@gmail.com">contact us</a>.
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

	.docs-main p { margin-bottom: 14px; }

	.docs-main a { color: oklch(0.7 0.12 240); text-decoration: none; }
	.docs-main a:hover { text-decoration: underline; }

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
