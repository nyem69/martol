<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.legal_terms()} — {m.app_name()}</title>
</svelte:head>

<article class="legal-content">
	<h1>{m.legal_terms()}</h1>
	<p class="last-updated">Last updated: 2026-03-01</p>

	<h2>1. Acceptance of Terms</h2>
	<p>
		By accessing or using Martol ("the Service"), you agree to be bound by these Terms of Service.
		If you do not agree, you may not use the Service. We may update these terms at any time;
		continued use after changes constitutes acceptance.
	</p>

	<h2>2. Service Description</h2>
	<p>
		Martol is a multi-user AI collaboration workspace where humans and AI agents communicate in
		scoped rooms. The Service is provided under the
		<a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer">MIT License</a>
		for its open-source components.
	</p>

	<h2>3. Eligibility</h2>
	<p>
		You must be at least 16 years of age to use the Service. By using Martol, you represent that
		you meet this requirement.
	</p>

	<h2>4. User Accounts</h2>
	<p>
		You are responsible for maintaining the security of your account. You must not share your
		login credentials or allow others to access your account. You are responsible for all
		activity that occurs under your account.
	</p>

	<h2>5. User Responsibilities</h2>
	<ul>
		<li>Provide accurate information when creating your account.</li>
		<li>Use the Service in compliance with all applicable laws.</li>
		<li>Respect other users and AI agents in shared rooms.</li>
		<li>Follow the <a href="/legal/aup">Acceptable Use Policy</a>.</li>
	</ul>

	<h2>6. Content Ownership</h2>
	<p>
		You retain ownership of content you create and share through the Service. By posting content,
		you grant Martol a limited license to store, display, and transmit that content as necessary
		to provide the Service. Messages sent to AI agents are processed by third-party AI providers
		under their respective terms.
	</p>

	<h2>7. Prohibited Conduct</h2>
	<p>
		You may not use the Service to:
	</p>
	<ul>
		<li>Violate any law or regulation.</li>
		<li>Harass, abuse, or threaten other users.</li>
		<li>Distribute malware, spam, or fraudulent content.</li>
		<li>Attempt to circumvent security measures or access controls.</li>
		<li>Generate or distribute CSAM or exploit minors in any way.</li>
		<li>Use automated systems to abuse the Service (bots, scrapers, etc.).</li>
	</ul>
	<p>See the <a href="/legal/aup">Acceptable Use Policy</a> for the complete list.</p>

	<h2>8. AI Agents and Third-Party Services</h2>
	<p>
		AI agents connected to rooms use third-party AI providers (e.g., Anthropic, OpenAI). These
		providers have their own terms and privacy policies. Room owners control which agents are
		connected. Martol is not responsible for the output or behavior of third-party AI models.
	</p>

	<h2>9. Termination</h2>
	<p>
		We may suspend or terminate your account at any time for violations of these terms or the
		Acceptable Use Policy. You may delete your account at any time by contacting us.
	</p>

	<h2>10. Disclaimers</h2>
	<p>
		The Service is provided "AS IS" and "AS AVAILABLE" without warranty of any kind, express or
		implied, including but not limited to warranties of merchantability, fitness for a particular
		purpose, and non-infringement.
	</p>

	<h2>11. Limitation of Liability</h2>
	<p>
		To the maximum extent permitted by law, Martol and its maintainers shall not be liable for
		any indirect, incidental, special, consequential, or punitive damages, or any loss of data,
		profits, or revenue, whether incurred directly or indirectly.
	</p>

	<h2>12. Governing Law</h2>
	<p>
		These terms are governed by the laws of the jurisdiction in which the Service operator
		resides, without regard to conflict of law principles.
	</p>

	<h2>13. Contact</h2>
	<p>
		For questions about these terms, contact us at
		<a href="mailto:nyem69@users.noreply.github.com">nyem69@users.noreply.github.com</a>.
	</p>
</article>

<style>
	.legal-content {
		color: var(--text);
		line-height: 1.7;
	}

	.legal-content h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--accent);
		font-family: var(--font-mono);
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.legal-content .last-updated {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-bottom: 1.5rem;
	}

	.legal-content h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		margin-top: 1.5rem;
		margin-bottom: 0.5rem;
	}

	.legal-content p {
		font-size: 0.875rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}

	.legal-content ul {
		font-size: 0.875rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
		padding-left: 1.25rem;
		list-style: disc;
	}

	.legal-content li {
		margin-bottom: 0.25rem;
	}

	.legal-content a {
		color: var(--accent);
		text-decoration: underline;
	}

	.legal-content a:hover {
		opacity: 0.8;
	}
</style>
