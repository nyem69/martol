<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Send, CheckCircle, AlertCircle } from '@lucide/svelte';

	let name = $state('');
	let email = $state('');
	let subject = $state('');
	let message = $state('');
	let submitting = $state(false);
	let submitted = $state(false);
	let errorMsg = $state('');

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		submitting = true;

		try {
			const res = await fetch('/api/contact', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, email, subject, message })
			});

			const data: { ok?: boolean; error?: string } = await res.json();

			if (!res.ok || !data.ok) {
				errorMsg = data.error || `Error: ${res.statusText}`;
				return;
			}

			submitted = true;
		} catch {
			errorMsg = 'Failed to send. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Contact — {m.app_name()}</title>
	<meta name="description" content="Get in touch with the Martol team" />
</svelte:head>

<div class="docs-layout">
	<main class="docs-main">
		<!-- Hero -->
		<section class="docs-hero">
			<h1>contact</h1>
			<p class="hero-tagline">Get in touch</p>
			<p class="hero-lead">
				Have a question, feature request, or partnership inquiry? Send us a message
				and we'll get back to you.
			</p>
		</section>

		{#if submitted}
			<section class="page-section">
				<div class="success-card">
					<CheckCircle size={32} style="color: var(--success);" />
					<h2>Message sent</h2>
					<p>Thanks for reaching out. We'll respond as soon as we can.</p>
					<button
						class="btn-primary"
						onclick={() => { submitted = false; name = ''; email = ''; subject = ''; message = ''; }}
					>
						Send another message
					</button>
				</div>
			</section>
		{:else}
			<section class="page-section">
				<form class="contact-form" onsubmit={handleSubmit}>
					<div class="form-row">
						<div class="form-group">
							<label for="contact-name">Name</label>
							<input
								id="contact-name"
								type="text"
								bind:value={name}
								required
								maxlength={100}
								placeholder="Your name"
								autocomplete="name"
							/>
						</div>
						<div class="form-group">
							<label for="contact-email">Email</label>
							<input
								id="contact-email"
								type="email"
								bind:value={email}
								required
								maxlength={254}
								placeholder="you@example.com"
								autocomplete="email"
							/>
						</div>
					</div>

					<div class="form-group">
						<label for="contact-subject">Subject</label>
						<input
							id="contact-subject"
							type="text"
							bind:value={subject}
							required
							maxlength={200}
							placeholder="What is this about?"
						/>
					</div>

					<div class="form-group">
						<label for="contact-message">Message</label>
						<textarea
							id="contact-message"
							bind:value={message}
							required
							maxlength={5000}
							rows={6}
							placeholder="Tell us more..."
						></textarea>
						<span class="char-count">{message.length} / 5000</span>
					</div>

					{#if errorMsg}
						<div class="error-bar">
							<AlertCircle size={14} />
							<span>{errorMsg}</span>
						</div>
					{/if}

					<button type="submit" class="btn-primary" disabled={submitting}>
						{#if submitting}
							Sending...
						{:else}
							<Send size={14} />
							Send message
						{/if}
					</button>
				</form>
			</section>
		{/if}
	</main>
</div>

<style>
	/* ── Layout ────────────────────────────────────────── */
	.docs-layout {
		height: 100dvh;
		overflow-y: auto;
		overflow-x: hidden;
		scroll-behavior: smooth;
	}

	/* ── Main Content ──────────────────────────────────── */
	.docs-main {
		margin: 0 auto;
		padding: 88px 48px 120px;
		max-width: 640px;
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
	}

	.docs-main p { margin-bottom: 14px; }

	/* ── Hero ──────────────────────────────────────────── */
	.docs-hero {
		margin-bottom: 40px;
		padding-bottom: 32px;
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
		margin-bottom: 0;
	}

	/* ── Form ──────────────────────────────────────────── */
	.contact-form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
		position: relative;
	}

	.form-group label {
		font-family: var(--font-mono-alt);
		font-size: 12px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.form-group input,
	.form-group textarea {
		font-family: var(--font-mono-alt);
		font-size: 14px;
		color: var(--text);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 10px 14px;
		transition: border-color 0.15s;
		resize: vertical;
	}

	.form-group input:focus,
	.form-group textarea:focus {
		outline: none;
		border-color: var(--accent);
	}

	.form-group input::placeholder,
	.form-group textarea::placeholder {
		color: var(--text-muted);
		opacity: 0.5;
	}

	.char-count {
		position: absolute;
		bottom: 8px;
		right: 12px;
		font-family: var(--font-mono-alt);
		font-size: 10px;
		color: var(--text-muted);
		opacity: 0.5;
	}

	/* ── Button ────────────────────────────────────────── */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-family: var(--font-mono-alt);
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--bg);
		background: var(--accent);
		border: none;
		border-radius: 6px;
		padding: 12px 24px;
		cursor: pointer;
		transition: opacity 0.15s;
		align-self: flex-start;
	}

	.btn-primary:hover { opacity: 0.85; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

	/* ── Error ─────────────────────────────────────────── */
	.error-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono-alt);
		font-size: 13px;
		color: var(--danger);
		background: color-mix(in oklch, var(--danger) 10%, transparent);
		border: 1px solid color-mix(in oklch, var(--danger) 25%, transparent);
		border-radius: 6px;
		padding: 10px 14px;
	}

	/* ── Success ───────────────────────────────────────── */
	.success-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
		padding: 48px 24px;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 12px;
	}

	.success-card h2 { margin-bottom: 0; }
	.success-card p { color: var(--text-muted); margin-bottom: 8px; }

	/* ── Responsive ────────────────────────────────────── */
	@media (max-width: 640px) {
		.docs-main {
			padding: 80px 20px 100px;
		}

		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
