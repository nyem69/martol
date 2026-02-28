<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { emailOtp, signIn } from '$lib/auth-client';
	import * as m from '$lib/paraglide/messages';

	let email = $state('');
	let code = $state('');
	let step = $state<'email' | 'code'>('email');
	let loading = $state(false);
	let error = $state('');

	async function handleSendOtp() {
		if (!email.trim()) return;
		loading = true;
		error = '';

		try {
			const result = await emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
			if (result.error) {
				error = result.error.message || m.login_otp_send_failed();
			} else {
				step = 'code';
				await tick();
				document.getElementById('code-input')?.focus();
			}
		} catch (e) {
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
				goto('/chat');
			}
		} catch (e) {
			error = m.error_generic();
		} finally {
			loading = false;
		}
	}

	async function handleBack() {
		step = 'email';
		code = '';
		error = '';
		await tick();
		document.getElementById('email-input')?.focus();
	}
</script>

<svelte:head>
	<title>{m.auth_sign_in()} — {m.app_name()}</title>
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

		{#if step === 'email'}
			<!-- Email entry -->
			<form onsubmit={(e) => { e.preventDefault(); handleSendOtp(); }}>
				<label for="email-input" class="block text-sm font-medium mb-2" style="color: var(--text-muted);">
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
				<button
					type="submit"
					disabled={loading || !email.trim()}
					data-testid="send-code-btn"
					class="mt-4 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
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
