<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { emailOtp, signIn } from '$lib/auth-client';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	let step = $state<'age' | 'email' | 'code'>('age');
	let loading = $state(false);
	let error = $state('');

	// Age gate
	let dobMonth = $state('');
	let dobDay = $state('');
	let dobYear = $state('');

	// Email + terms
	let email = $state('');
	let agreedToTos = $state(false);
	let agreedToPrivacy = $state(false);
	let honeypot = $state(''); // hidden field — bots fill it, humans don't

	// OTP
	let code = $state('');

	// Turnstile
	const turnstileSiteKey = $derived(data.turnstileSiteKey);
	let turnstileToken = $state('');
	let turnstileWidgetId = $state<string | null>(null);

	function onTurnstileCallback(token: string) {
		turnstileToken = token;
	}

	function renderTurnstile(node: HTMLElement) {
		if (!turnstileSiteKey || typeof window === 'undefined') return;
		let timerId: ReturnType<typeof setTimeout> | null = null;
		let destroyed = false;

		const tryRender = () => {
			if (destroyed) return;
			if ((window as any).turnstile) {
				turnstileWidgetId = (window as any).turnstile.render(node, {
					sitekey: turnstileSiteKey,
					callback: onTurnstileCallback,
					theme: 'dark',
					size: 'flexible'
				});
			} else {
				timerId = setTimeout(tryRender, 100);
			}
		};
		tryRender();

		return {
			destroy() {
				destroyed = true;
				if (timerId !== null) clearTimeout(timerId);
				if (turnstileWidgetId != null && (window as any).turnstile) {
					(window as any).turnstile.remove(turnstileWidgetId);
				}
			}
		};
	}

	function resetTurnstile() {
		turnstileToken = '';
		if (turnstileWidgetId != null && (window as any).turnstile) {
			(window as any).turnstile.reset(turnstileWidgetId);
		}
	}

	const MIN_AGE = 16;

	function calculateAge(year: number, month: number, day: number): number {
		const today = new Date();
		const birthDate = new Date(year, month - 1, day);
		let age = today.getFullYear() - birthDate.getFullYear();
		const monthDiff = today.getMonth() - birthDate.getMonth();
		if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
			age--;
		}
		return age;
	}

	function handleAgeGate() {
		error = '';
		const year = parseInt(dobYear);
		const month = parseInt(dobMonth);
		const day = parseInt(dobDay);

		if (!year || !month || !day || year < 1900 || year > new Date().getFullYear()) {
			error = 'Please enter a valid date of birth.';
			return;
		}

		const age = calculateAge(year, month, day);
		if (age < MIN_AGE) {
			error = m.age_gate_blocked();
			return;
		}

		step = 'email';
	}

	async function handleSendOtp() {
		if (!email.trim() || !agreedToTos || !agreedToPrivacy) return;
		if (turnstileSiteKey && !turnstileToken) return;
		// Honeypot check — if filled, silently "succeed" (bot trap)
		if (honeypot) {
			step = 'code';
			return;
		}
		loading = true;
		error = '';

		try {
			const fetchHeaders: Record<string, string> = {};
			if (turnstileToken) {
				fetchHeaders['x-captcha-response'] = turnstileToken;
			}

			const result = await emailOtp.sendVerificationOtp({
				email: email.trim(),
				type: 'sign-in',
				fetchOptions: { headers: fetchHeaders }
			});
			if (result.error) {
				resetTurnstile();
				error = result.error.message || m.login_otp_send_failed();
			} else {
				step = 'code';
				await tick();
				document.getElementById('code-input')?.focus();
			}
		} catch {
			resetTurnstile();
			error = m.error_generic();
		} finally {
			loading = false;
		}
	}

	async function handleVerifyCode() {
		if (code.length !== 6) return;
		loading = true;
		error = '';

		try {
			const result = await signIn.emailOtp({ email: email.trim(), otp: code });
			if (result.error) {
				error = result.error.message || m.login_code_invalid();
			} else {
				// Record terms acceptance server-side
				try {
					await fetch('/api/terms', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ types: ['tos', 'privacy', 'aup'] })
					});
				} catch {
					// Non-blocking — terms acceptance is best-effort during login
					console.warn('[Login] Failed to record terms acceptance');
				}
				goto('/chat');
			}
		} catch {
			error = m.error_generic();
		} finally {
			loading = false;
		}
	}

	async function handleBack() {
		if (step === 'code') {
			step = 'email';
			code = '';
		} else if (step === 'email') {
			step = 'age';
		}
		error = '';
		await tick();
		if (step === 'email') document.getElementById('email-input')?.focus();
	}

	const months = Array.from({ length: 12 }, (_, i) => ({
		value: String(i + 1),
		label: new Date(2000, i).toLocaleString('en', { month: 'long' })
	}));
</script>

<svelte:head>
	<title>{m.auth_sign_in()} — {m.app_name()}</title>
	{#if turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<div class="flex min-h-dvh items-center justify-center px-4" style="background: var(--bg);">
	<div
		class="w-full max-w-sm"
		style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem;"
	>
		<!-- Header -->
		<div class="mb-8 text-center">
			<h1
				class="text-2xl font-bold tracking-widest"
				style="color: var(--accent); font-family: var(--font-mono);"
			>
				MARTOL
			</h1>
			<p class="mt-2 text-sm" style="color: var(--text-muted);">
				{m.login_subtitle()}
			</p>
		</div>

		{#if step === 'age'}
			<!-- Age gate — BEFORE email collection -->
			<div>
				<p class="mb-4 text-sm" style="color: var(--text-muted);">
					{m.age_gate_subtitle()}
				</p>

				<div class="grid grid-cols-3 gap-2">
					<div>
						<label for="dob-month" class="mb-1 block text-xs" style="color: var(--text-muted);">
							{m.age_gate_month()}
						</label>
						<select
							id="dob-month"
							bind:value={dobMonth}
							data-testid="dob-month"
							class="w-full rounded-md px-2 py-2.5 text-sm outline-none"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						>
							<option value="">—</option>
							{#each months as { value, label }}
								<option {value}>{label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="dob-day" class="mb-1 block text-xs" style="color: var(--text-muted);">
							{m.age_gate_day()}
						</label>
						<input
							id="dob-day"
							type="number"
							min="1"
							max="31"
							bind:value={dobDay}
							placeholder="DD"
							data-testid="dob-day"
							class="w-full rounded-md px-2 py-2.5 text-center text-sm outline-none"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						/>
					</div>
					<div>
						<label for="dob-year" class="mb-1 block text-xs" style="color: var(--text-muted);">
							{m.age_gate_year()}
						</label>
						<input
							id="dob-year"
							type="number"
							min="1900"
							max={new Date().getFullYear()}
							bind:value={dobYear}
							placeholder="YYYY"
							data-testid="dob-year"
							class="w-full rounded-md px-2 py-2.5 text-center text-sm outline-none"
							style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
						/>
					</div>
				</div>

				<button
					onclick={handleAgeGate}
					disabled={!dobMonth || !dobDay || !dobYear}
					data-testid="age-continue-btn"
					class="mt-4 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
					style="background: var(--accent); color: var(--bg); letter-spacing: 0.5px;"
				>
					{m.age_gate_continue()}
				</button>
			</div>
		{:else if step === 'email'}
			<!-- Email entry + separate terms -->
			<div>
				<button
					onclick={handleBack}
					class="mb-4 inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm hover:underline"
					style="color: var(--text-muted);"
				>
					&larr; {m.login_back()}
				</button>

				<form onsubmit={(e) => { e.preventDefault(); handleSendOtp(); }}>
					<label for="email-input" class="mb-2 block text-sm font-medium" style="color: var(--text-muted);">
						{m.login_email_label()}
					</label>
					<input
						id="email-input"
						type="email"
						bind:value={email}
						placeholder="you@example.com"
						required
						disabled={loading}
						data-testid="email-input"
						class="w-full rounded-md px-3 py-2.5 text-sm outline-none"
						style="background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono);"
					/>

					<!-- Honeypot — hidden field, bots fill it, humans don't -->
					<div style="position: absolute; left: -9999px;" aria-hidden="true">
						<input
							type="text"
							name="website"
							tabindex="-1"
							autocomplete="off"
							bind:value={honeypot}
						/>
					</div>

					<!-- Separate ToS checkbox -->
					<label class="mt-4 flex cursor-pointer items-start gap-2">
						<input
							type="checkbox"
							bind:checked={agreedToTos}
							data-testid="tos-checkbox"
							class="mt-0.5 shrink-0 rounded"
							style="accent-color: var(--accent);"
						/>
						<span class="text-[11px] leading-tight" style="color: var(--text-muted);">
							{m.login_tos_label()}
							<a href="/legal/terms" class="underline" style="color: var(--accent);">{m.legal_terms()}</a>
						</span>
					</label>

					<!-- Separate Privacy Policy checkbox -->
					<label class="mt-2 flex cursor-pointer items-start gap-2">
						<input
							type="checkbox"
							bind:checked={agreedToPrivacy}
							data-testid="privacy-checkbox"
							class="mt-0.5 shrink-0 rounded"
							style="accent-color: var(--accent);"
						/>
						<span class="text-[11px] leading-tight" style="color: var(--text-muted);">
							{m.login_privacy_label()}
							<a href="/legal/privacy" class="underline" style="color: var(--accent);">{m.legal_privacy()}</a>
							{m.login_agree_and()}
							<a href="/legal/aup" class="underline" style="color: var(--accent);">{m.legal_aup()}</a>
						</span>
					</label>

					{#if turnstileSiteKey}
						<div class="mt-3" use:renderTurnstile></div>
					{/if}

					<button
						type="submit"
						disabled={loading || !email.trim() || !agreedToTos || !agreedToPrivacy || (!!turnstileSiteKey && !turnstileToken)}
						data-testid="send-code-btn"
						class="mt-3 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
						style="background: var(--accent); color: var(--bg); letter-spacing: 0.5px;"
					>
						{#if loading}
							<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
							{m.chat_sending()}
						{:else}
							{m.login_continue()}
						{/if}
					</button>
				</form>
			</div>
		{:else}
			<!-- Code entry -->
			<div>
				<button
					onclick={handleBack}
					class="mb-4 inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm hover:underline"
					style="color: var(--text-muted);"
				>
					&larr; {m.login_back()}
				</button>

				<p class="mb-4 text-sm" style="color: var(--text-muted);">
					{m.auth_check_email()}
				</p>

				<form onsubmit={(e) => { e.preventDefault(); handleVerifyCode(); }}>
					<label for="code-input" class="sr-only">Verification code</label>
					<input
						id="code-input"
						type="text"
						bind:value={code}
						placeholder="000000"
						maxlength="6"
						inputmode="numeric"
						pattern="[0-9]*"
						required
						disabled={loading}
						data-testid="code-input"
						class="w-full rounded-md px-3 py-3 text-center text-2xl tracking-[0.5em] outline-none"
						style="background: var(--bg); border: 1px solid var(--border); color: var(--accent); font-family: var(--font-mono);"
					/>
					<button
						type="submit"
						disabled={loading || code.length !== 6}
						data-testid="verify-btn"
						class="mt-4 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
						style="background: var(--accent); color: var(--bg); letter-spacing: 0.5px;"
					>
						{#if loading}
							<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
							{m.login_verifying()}
						{:else}
							{m.auth_sign_in()}
						{/if}
					</button>
				</form>
			</div>
		{/if}

		{#if error}
			<p class="mt-4 text-center text-sm" style="color: var(--danger);" data-testid="error-msg">
				{error}
			</p>
		{/if}
	</div>
</div>
