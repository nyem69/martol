<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.legal_privacy()} — {m.app_name()}</title>
</svelte:head>

<article class="legal-content">
	<h1>{m.legal_privacy()}</h1>
	<p class="last-updated">Last updated: 2026-03-01</p>

	<h2>1. Data We Collect</h2>
	<ul>
		<li><strong>Email address</strong> — used for passwordless sign-in (OTP) and account identity.</li>
		<li><strong>Chat messages</strong> — stored in our database to provide the chat service. Messages are associated with your user ID and the room they belong to.</li>
		<li><strong>Usage metadata</strong> — timestamps, connection events, and typing indicators for real-time features. These are transient and not stored long-term.</li>
		<li><strong>IP address and user agent</strong> — collected for rate limiting, abuse prevention, and terms acceptance records.</li>
		<li><strong>File uploads</strong> — files you upload to rooms are stored in Cloudflare R2, namespaced by organization and message.</li>
	</ul>

	<h2>2. What We Don't Collect</h2>
	<ul>
		<li>We do not track you across websites.</li>
		<li>We do not sell your data to third parties.</li>
		<li>We do not use your data for advertising.</li>
		<li>We do not use analytics trackers or third-party cookies.</li>
	</ul>

	<h2>3. Legal Basis for Processing</h2>
	<p>
		We process your data based on: (a) your consent when creating an account and accepting these
		terms; (b) legitimate interest in providing and securing the Service; (c) legal obligations
		such as responding to lawful requests.
	</p>

	<h2>4. AI Provider Disclosure</h2>
	<p>
		When an AI agent is connected to a room, messages directed at the agent are sent to the
		configured AI provider for processing. Each provider has its own privacy policy:
	</p>
	<ul>
		<li><a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer">Anthropic Privacy Policy</a></li>
		<li><a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer">OpenAI Privacy Policy</a></li>
	</ul>
	<p>
		AI providers receive only the messages in the agent's context window (default: last 50
		messages in the room). The room owner controls which agents are connected. AI-generated
		content is clearly labeled in the interface.
	</p>

	<h2>5. Data Storage Locations</h2>
	<ul>
		<li><strong>Chat messages and user accounts</strong> — PostgreSQL hosted by Aiven (EU region).</li>
		<li><strong>File uploads</strong> — Cloudflare R2 (globally distributed).</li>
		<li><strong>Session data</strong> — Cloudflare KV (edge-cached, globally distributed).</li>
		<li><strong>Real-time state</strong> — Cloudflare Durable Objects (transient, globally distributed).</li>
	</ul>

	<h2>6. Data Retention</h2>
	<ul>
		<li>Messages are retained as long as the organization (room) exists. Room owners can clear messages at any time using <code>/clear</code>.</li>
		<li>Deleted messages are soft-deleted and purged within 30 days.</li>
		<li>Account deletion removes all associated data.</li>
		<li>Session data expires after 7 days of inactivity.</li>
		<li>Rate limiting records expire automatically (within 1 hour).</li>
	</ul>

	<h2>7. Your Rights</h2>
	<p>You have the right to:</p>
	<ul>
		<li><strong>Access</strong> — request a copy of your personal data.</li>
		<li><strong>Correction</strong> — request correction of inaccurate data.</li>
		<li><strong>Deletion</strong> — request deletion of your account and data.</li>
		<li><strong>Portability</strong> — request your data in a machine-readable format.</li>
		<li><strong>Objection</strong> — object to processing based on legitimate interest.</li>
		<li><strong>Restriction</strong> — request that we restrict processing of your data (e.g., during dispute resolution).</li>
		<li><strong>Complaint</strong> — lodge a complaint with your local data protection supervisory authority.</li>
	</ul>
	<p>
		To exercise these rights, contact us at
		<a href="mailto:nyem69@users.noreply.github.com">nyem69@users.noreply.github.com</a>.
	</p>

	<h2>8. Children's Privacy</h2>
	<p>
		The Service is not intended for users under 16 years of age. We do not knowingly collect
		data from children under 16. If we learn that we have collected data from a child under 16,
		we will delete it promptly.
	</p>

	<h2>9. International Transfers</h2>
	<p>
		Your data may be processed in multiple jurisdictions due to our use of globally distributed
		infrastructure (Cloudflare). Primary data storage is in the EU (Aiven PostgreSQL).
	</p>

	<h2>10. Changes</h2>
	<p>
		We may update this policy. Changes will be noted by the "Last updated" date above.
		Significant changes will be communicated through the Service.
	</p>

	<h2>11. Contact</h2>
	<p>
		For privacy questions or data requests, contact us at
		<a href="mailto:nyem69@users.noreply.github.com">nyem69@users.noreply.github.com</a>.
	</p>
</article>
