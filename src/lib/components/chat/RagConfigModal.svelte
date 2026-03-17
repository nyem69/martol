<script lang="ts">
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { X, Loader, Check, Settings } from '@lucide/svelte';

	let {
		roomId,
		ragConfig,
		userRole,
		onClose,
		onSave
	}: {
		roomId: string;
		ragConfig: {
			ragEnabled: boolean;
			ragModel: string;
			ragTemperature: number;
			ragMaxTokens: number;
			ragTrigger: string;
			ragProvider?: string;
			ragBaseUrl?: string;
		};
		userRole: string;
		onClose: () => void;
		onSave: (config: any) => void;
	} = $props();

	const canEdit = $derived(userRole === 'owner' || userRole === 'admin');

	// svelte-ignore state_referenced_locally — modal is recreated each open
	let enabled = $state(ragConfig.ragEnabled);
	// svelte-ignore state_referenced_locally
	let model = $state(ragConfig.ragModel);
	// svelte-ignore state_referenced_locally
	let temperature = $state(ragConfig.ragTemperature);
	// svelte-ignore state_referenced_locally
	let maxTokens = $state(ragConfig.ragMaxTokens);
	// svelte-ignore state_referenced_locally
	let trigger = $state(ragConfig.ragTrigger);
	// svelte-ignore state_referenced_locally
	let provider = $state(ragConfig.ragProvider ?? 'workers_ai');
	// svelte-ignore state_referenced_locally
	let baseUrl = $state(ragConfig.ragBaseUrl ?? '');
	let saving = $state(false);
	let saveStatus = $state<'idle' | 'saved' | 'error'>('idle');
	let error = $state('');

	let closeBtn: HTMLButtonElement | undefined;
	let prevFocus: HTMLElement | null = null;
	let dialogEl: HTMLDivElement | undefined;

	const WORKERS_AI_MODELS = [
		'@cf/meta/llama-3.1-8b-instruct',
		'@cf/meta/llama-3.3-70b-instruct-fp8-fast',
		'@cf/mistral/mistral-7b-instruct-v0.2'
	];

	const TEMPERATURE_PRESETS = [0.1, 0.3, 0.5, 0.7, 1.0];
	const MAX_TOKEN_PRESETS = [512, 1024, 2048, 4096];

	$effect(() => {
		prevFocus = document.activeElement as HTMLElement;
		untrack(() => closeBtn?.focus());
		return () => prevFocus?.focus();
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
		if (e.key === 'Tab' && dialogEl) {
			const focusable = dialogEl.querySelectorAll<HTMLElement>(
				'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	async function save() {
		if (!canEdit || saving) return;
		saving = true;
		error = '';
		saveStatus = 'idle';
		try {
			const res = await fetch(`/api/rooms/${roomId}/rag-config`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ragEnabled: enabled,
					ragModel: model,
					ragTemperature: temperature,
					ragMaxTokens: maxTokens,
					ragTrigger: trigger,
					ragProvider: provider,
					ragBaseUrl: provider === 'openai' ? baseUrl : null
				})
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				error = (data as { message?: string }).message || m.rag_config_error();
				saveStatus = 'error';
				return;
			}
			const result = await res.json();
			saveStatus = 'saved';
			onSave(result);
			setTimeout(() => {
				if (saveStatus === 'saved') onClose();
			}, 600);
		} catch {
			error = m.rag_config_error();
			saveStatus = 'error';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center p-4"
	style="background: rgba(0, 0, 0, 0.85);"
	role="dialog"
	aria-modal="true"
	aria-label={m.rag_config_title()}
>
	<button
		class="absolute inset-0 cursor-default border-none bg-transparent"
		onclick={onClose}
		aria-label={m.chat_close()}
		tabindex="-1"
		data-testid="rag-config-modal-backdrop"
	></button>

	<div
		bind:this={dialogEl}
		class="rag-dialog relative z-10 flex w-full max-w-md flex-col rounded-lg"
	>
		<!-- Header -->
		<div class="rag-header flex items-center justify-between px-5 py-3">
			<div class="flex items-center gap-2.5">
				<Settings size={14} style="color: var(--accent);" />
				<h2 class="rag-title">
					{m.rag_config_title()}
				</h2>
			</div>
			<button
				bind:this={closeBtn}
				class="rounded p-1 transition-colors hover:opacity-80"
				style="color: var(--text-muted);"
				onclick={onClose}
				aria-label={m.chat_close()}
				data-testid="rag-config-modal-close"
			>
				<X size={16} />
			</button>
		</div>

		<!-- Body -->
		<div class="rag-body flex-1 overflow-y-auto">
			<div class="flex flex-col gap-5 px-5 py-4">
				<!-- Enable toggle -->
				<div class="flex items-center justify-between">
					<label class="rag-label" for="rag-enabled">{m.rag_config_enable()}</label>
					<button
						id="rag-enabled"
						class="rag-toggle"
						class:active={enabled}
						onclick={() => { if (canEdit) enabled = !enabled; }}
						disabled={!canEdit}
						role="switch"
						aria-checked={enabled}
						aria-label={m.rag_config_enable()}
						data-testid="rag-toggle-enabled"
					>
						<span class="rag-toggle-thumb"></span>
					</button>
				</div>

				{#if enabled}
					<!-- Provider -->
					<div class="rag-field">
						<label class="rag-label" for="rag-provider">{m.rag_config_provider()}</label>
						<select
							id="rag-provider"
							class="rag-select"
							bind:value={provider}
							disabled={!canEdit}
							data-testid="rag-provider-select"
						>
							<option value="workers_ai">{m.rag_config_provider_workers_ai()}</option>
							<option value="openai">{m.rag_config_provider_openai()}</option>
						</select>
					</div>

					<!-- Model -->
					<div class="rag-field">
						<label class="rag-label" for="rag-model">{m.rag_config_model()}</label>
						{#if provider === 'workers_ai'}
							<select
								id="rag-model"
								class="rag-select"
								bind:value={model}
								disabled={!canEdit}
								data-testid="rag-model-select"
							>
								{#each WORKERS_AI_MODELS as m_name}
									<option value={m_name}>{m_name}</option>
								{/each}
							</select>
						{:else}
							<input
								id="rag-model"
								type="text"
								class="rag-input"
								bind:value={model}
								placeholder="gpt-4o-mini"
								disabled={!canEdit}
								data-testid="rag-model-input"
							/>
						{/if}
					</div>

					<!-- Base URL (OpenAI only) -->
					{#if provider === 'openai'}
						<div class="rag-field">
							<label class="rag-label" for="rag-base-url">{m.rag_config_base_url()}</label>
							<input
								id="rag-base-url"
								type="text"
								class="rag-input"
								bind:value={baseUrl}
								placeholder="https://api.openai.com/v1"
								disabled={!canEdit}
								data-testid="rag-base-url-input"
							/>
						</div>

						<!-- API Key status -->
						<div class="rag-field">
							<span class="rag-label">{m.rag_config_api_key()}</span>
							<div class="rag-key-status">
								<span class="rag-key-badge">
									{m.rag_config_api_key_none()}
								</span>
								<span class="text-[9px]" style="color: var(--text-muted); font-family: var(--font-mono);">
									(coming soon)
								</span>
							</div>
						</div>
					{/if}

					<!-- Temperature -->
					<div class="rag-field">
						<label class="rag-label" for="rag-temperature">{m.rag_config_temperature()}</label>
						<select
							id="rag-temperature"
							class="rag-select"
							bind:value={temperature}
							disabled={!canEdit}
							data-testid="rag-temperature-select"
						>
							{#each TEMPERATURE_PRESETS as t}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</div>

					<!-- Max tokens -->
					<div class="rag-field">
						<label class="rag-label" for="rag-max-tokens">{m.rag_config_max_tokens()}</label>
						<select
							id="rag-max-tokens"
							class="rag-select"
							bind:value={maxTokens}
							disabled={!canEdit}
							data-testid="rag-max-tokens-select"
						>
							{#each MAX_TOKEN_PRESETS as t}
								<option value={t}>{t.toLocaleString()}</option>
							{/each}
						</select>
					</div>

					<!-- Trigger mode -->
					<div class="rag-field">
						<label class="rag-label" for="rag-trigger">{m.rag_config_trigger()}</label>
						<select
							id="rag-trigger"
							class="rag-select"
							bind:value={trigger}
							disabled={!canEdit}
							data-testid="rag-trigger-select"
						>
							<option value="explicit">{m.rag_config_trigger_explicit()}</option>
							<option value="always">{m.rag_config_trigger_always()}</option>
						</select>
					</div>
				{/if}
			</div>
		</div>

		<!-- Footer -->
		<div class="rag-footer">
			{#if error}
				<div class="rag-alert" role="alert">
					{error}
				</div>
			{/if}
			<div class="flex items-center justify-end gap-2">
				{#if !canEdit}
					<span class="mr-auto text-[9px]" style="color: var(--text-muted); font-family: var(--font-mono);">
						{m.chat_brief_readonly_hint()}
					</span>
				{/if}
				<button
					class="rag-btn rag-btn-secondary"
					onclick={onClose}
					data-testid="rag-config-modal-cancel"
				>
					{m.chat_close()}
				</button>
				{#if canEdit}
					<button
						class="rag-btn rag-btn-primary"
						onclick={save}
						disabled={saving}
						data-testid="rag-config-modal-save"
					>
						{#if saving}
							<Loader size={11} class="animate-spin" />
							{m.rag_config_saving()}
						{:else if saveStatus === 'saved'}
							<Check size={11} />
							{m.rag_config_saved()}
						{:else}
							{m.rag_config_save()}
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	/* ── Dialog shell ─────────────────────────────────── */
	.rag-dialog {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		max-height: 85vh;
	}

	/* ── Header ───────────────────────────────────────── */
	.rag-header {
		border-bottom: 1px solid var(--border);
	}

	.rag-title {
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--text-primary);
		font-family: var(--font-mono);
	}

	/* ── Body ─────────────────────────────────────────── */
	.rag-body {
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	/* ── Fields ───────────────────────────────────────── */
	.rag-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.rag-label {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.rag-select,
	.rag-input {
		width: 100%;
		background: var(--bg-input, var(--bg));
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 11px;
		line-height: 1.6;
		font-family: var(--font-mono);
		color: var(--text-primary);
		outline: none;
		transition: border-color 150ms ease;
	}

	.rag-select:focus,
	.rag-input:focus {
		border-color: var(--accent);
	}

	.rag-select:disabled,
	.rag-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.rag-input::placeholder {
		color: var(--text-muted);
		opacity: 0.5;
	}

	/* ── Toggle switch ────────────────────────────────── */
	.rag-toggle {
		position: relative;
		width: 36px;
		height: 20px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--bg);
		cursor: pointer;
		transition: all 150ms ease;
		padding: 0;
	}

	.rag-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.rag-toggle.active {
		background: var(--accent);
		border-color: var(--accent);
	}

	.rag-toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--text-muted);
		transition: all 150ms ease;
	}

	.rag-toggle.active .rag-toggle-thumb {
		left: 18px;
		background: var(--bg);
	}

	/* ── API key status ───────────────────────────────── */
	.rag-key-status {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.rag-key-badge {
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 10px;
		font-family: var(--font-mono);
		background: var(--bg-hover);
		color: var(--text-muted);
	}

	/* ── Footer ───────────────────────────────────────── */
	.rag-footer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--border);
		padding: 10px 20px;
	}

	.rag-alert {
		border-radius: 4px;
		padding: 6px 10px;
		font-size: 10px;
		background: var(--danger-bg, rgba(239, 68, 68, 0.1));
		color: var(--danger, #ef4444);
	}

	/* ── Buttons ──────────────────────────────────────── */
	.rag-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 5px 12px;
		border-radius: 6px;
		font-size: 11px;
		font-family: var(--font-mono);
		font-weight: 600;
		cursor: pointer;
		transition: opacity 150ms ease;
		border: 1px solid var(--border);
	}

	.rag-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.rag-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.rag-btn-primary {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
	}

	.rag-btn-secondary {
		background: transparent;
		color: var(--text-muted);
	}
</style>
