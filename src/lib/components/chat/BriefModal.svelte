<script lang="ts">
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { X, Loader, Check, Bot, ChevronDown, Pencil, Eye } from '@lucide/svelte';
	import {
		type BriefSections,
		SECTION_META,
		parseBriefContent,
		serializeBriefSections,
		totalLength
	} from '$lib/brief-sections';

	let {
		orgId,
		currentBrief,
		currentVersion,
		canEdit,
		onclose,
		agents,
		onAskAgent
	}: {
		orgId: string;
		currentBrief: string;
		currentVersion: number;
		canEdit: boolean;
		onclose: () => void;
		agents: Array<{ name: string }>;
		onAskAgent: (agentName: string) => void;
	} = $props();

	const MAX_TOTAL = 10_000;

	// svelte-ignore state_referenced_locally — modal is recreated each open, initial value is stable
	let sections = $state<BriefSections>(parseBriefContent(currentBrief));
	// svelte-ignore state_referenced_locally
	let version = $state(currentVersion);
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
	let agentPickerOpen = $state(false);
	let editing = $state(false);
	let closeBtn: HTMLButtonElement | undefined;
	let prevFocus: HTMLElement | null = null;
	let dialogEl: HTMLDivElement | undefined;

	const charCount = $derived(totalLength(sections));
	const isEmpty = $derived(charCount === 0);

	$effect(() => {
		prevFocus = document.activeElement as HTMLElement;
		untrack(() => closeBtn?.focus());
		return () => prevFocus?.focus();
	});

	// Auto-resize textareas when content changes or mode switches
	$effect(() => {
		if (!editing) return;
		// Touch sections to subscribe
		void sections.goal, sections.stack, sections.conventions, sections.phase, sections.notes;
		// Tick delay so DOM has rendered
		requestAnimationFrame(() => {
			dialogEl?.querySelectorAll<HTMLTextAreaElement>('.brief-edit-textarea').forEach((ta) => {
				ta.style.height = 'auto';
				ta.style.height = ta.scrollHeight + 'px';
			});
		});
	});

	const labelFn: Record<string, () => string> = {
		goal: () => m.chat_brief_section_goal(),
		stack: () => m.chat_brief_section_stack(),
		conventions: () => m.chat_brief_section_conventions(),
		phase: () => m.chat_brief_section_phase(),
		notes: () => m.chat_brief_section_notes(),
	};

	const placeholderFn: Record<string, () => string> = {
		goal: () => m.chat_brief_placeholder_goal(),
		stack: () => m.chat_brief_placeholder_stack(),
		conventions: () => m.chat_brief_placeholder_conventions(),
		phase: () => m.chat_brief_placeholder_phase(),
		notes: () => m.chat_brief_placeholder_notes(),
	};

	function enterEdit() {
		if (!canEdit) return;
		editing = true;
	}

	function cancelEdit() {
		sections = parseBriefContent(currentBrief);
		editing = false;
		saveStatus = 'idle';
	}

	async function save() {
		if (!canEdit || saveStatus === 'saving') return;
		saveStatus = 'saving';
		try {
			const res = await fetch(`/api/rooms/${orgId}/brief`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ brief: serializeBriefSections(sections), expectedVersion: version })
			});
			const data: { ok?: boolean; version?: number; currentVersion?: number } = await res.json();
			if (data.ok) {
				version = data.version ?? version + 1;
				saveStatus = 'saved';
				editing = false;
				setTimeout(() => { if (saveStatus === 'saved') saveStatus = 'idle'; }, 2000);
			} else if (res.status === 409) {
				saveStatus = 'conflict';
				try {
					const reload = await fetch(`/api/rooms/${orgId}/brief`);
					const reloaded: { ok?: boolean; brief?: string; version?: number } = await reload.json();
					if (reloaded.ok) {
						sections = parseBriefContent(reloaded.brief ?? '');
						version = reloaded.version ?? 0;
					}
				} catch { /* silent */ }
				setTimeout(() => { if (saveStatus === 'conflict') saveStatus = 'idle'; }, 2000);
			} else {
				saveStatus = 'error';
			}
		} catch {
			saveStatus = 'error';
		}
	}

	function autoResize(e: Event) {
		const ta = e.target as HTMLTextAreaElement;
		ta.style.height = 'auto';
		ta.style.height = ta.scrollHeight + 'px';
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (editing) { cancelEdit(); return; }
			onclose();
		}
		if (e.key === 'Tab' && dialogEl) {
			const focusable = dialogEl.querySelectorAll<HTMLElement>(
				'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center p-4"
	style="background: rgba(0, 0, 0, 0.85);"
	role="dialog"
	aria-modal="true"
	aria-label={m.chat_brief_modal_title()}
>
	<button
		class="absolute inset-0 cursor-default border-none bg-transparent"
		onclick={onclose}
		aria-label={m.chat_close()}
		tabindex="-1"
		data-testid="brief-modal-backdrop"
	></button>

	<div
		bind:this={dialogEl}
		class="brief-dialog relative z-10 flex w-full max-w-2xl flex-col rounded-lg"
	>
		<!-- Header -->
		<div class="brief-header flex items-center justify-between px-5 py-3">
			<div class="flex items-center gap-2.5">
				<h2 class="brief-title">
					{m.chat_brief_modal_title()}
				</h2>
				<span class="brief-version-badge">
					v{version}
				</span>
				{#if !editing && canEdit}
					<button
						class="brief-mode-btn"
						onclick={enterEdit}
						data-testid="brief-modal-edit"
					>
						<Pencil size={11} />
						{m.chat_brief_edit()}
					</button>
				{/if}
				{#if editing}
					<button
						class="brief-mode-btn brief-mode-active"
						onclick={cancelEdit}
					>
						<Eye size={11} />
						{m.chat_brief_read()}
					</button>
				{/if}
			</div>
			<button
				bind:this={closeBtn}
				class="rounded p-1 transition-colors hover:opacity-80"
				style="color: var(--text-muted);"
				onclick={onclose}
				aria-label={m.chat_close()}
				data-testid="brief-modal-close"
			>
				<X size={16} />
			</button>
		</div>

		<!-- Body — single scrollable area -->
		<div class="brief-body flex-1 overflow-y-auto">
			{#if editing}
				<!-- ═══ EDIT MODE ═══ -->
				<div class="brief-sections-edit">
					{#each SECTION_META as sec}
						<div class="brief-edit-section">
							<label
								for="brief-{sec.key}"
								class="brief-label"
							>
								{labelFn[sec.key]()}
							</label>
							<textarea
								id="brief-{sec.key}"
								bind:value={sections[sec.key]}
								placeholder={placeholderFn[sec.key]()}
								rows={2}
								class="brief-edit-textarea"
								oninput={autoResize}
								data-testid="brief-section-{sec.key}"
							></textarea>
						</div>
					{/each}
				</div>
			{:else}
				<!-- ═══ READ MODE ═══ -->
				{#if isEmpty}
					<div class="brief-empty">
						<p class="brief-empty-text">{m.chat_brief_empty()}</p>
						<p class="brief-empty-hint">
							{#if canEdit}
								{m.chat_brief_empty_hint_edit()}
							{:else}
								{m.chat_brief_readonly_hint()}
							{/if}
						</p>
					</div>
				{:else}
					<div class="brief-sections-read">
						{#each SECTION_META as sec}
							{#if sections[sec.key].trim()}
								<div class="brief-read-section">
									<h3 class="brief-read-heading">{labelFn[sec.key]()}</h3>
									<div class="brief-read-content">{sections[sec.key]}</div>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		<!-- Footer -->
		<div class="brief-footer">
			{#if saveStatus === 'error'}
				<div class="brief-alert brief-alert-error" role="alert">
					{m.chat_brief_save_error()}
				</div>
			{:else if saveStatus === 'conflict'}
				<div class="brief-alert brief-alert-warning" role="alert">
					{m.chat_brief_conflict()}
				</div>
			{/if}
			<div class="flex items-center justify-between">
				<span class="brief-char-count" class:over-limit={charCount > MAX_TOTAL}>
					{#if editing}
						{charCount.toLocaleString()}/{MAX_TOTAL.toLocaleString()}
					{/if}
				</span>

				<div class="flex items-center gap-2" aria-live="polite">
					{#if !canEdit}
						<span class="brief-readonly-hint">
							{m.chat_brief_readonly_hint()}
						</span>
					{/if}
					{#if agents.length === 1}
						<button
							class="brief-btn brief-btn-secondary"
							onclick={() => { onAskAgent(agents[0].name); onclose(); }}
							data-testid="brief-modal-ask-agent"
						>
							<Bot size={12} />
							{m.chat_brief_ask_agent()}
						</button>
					{:else if agents.length > 1}
						<div class="relative">
							<button
								class="brief-btn brief-btn-secondary"
								onclick={() => { agentPickerOpen = !agentPickerOpen; }}
								aria-expanded={agentPickerOpen}
								data-testid="brief-modal-ask-agent"
							>
								<Bot size={12} />
								{m.chat_brief_ask_agent()}
								<ChevronDown size={10} />
							</button>
							{#if agentPickerOpen}
								<div class="agent-picker absolute bottom-full left-0 z-10 mb-1 min-w-40 rounded-lg border py-1 shadow-xl"
									style="background: var(--bg-elevated); border-color: var(--border);"
								>
									{#each agents as agent}
										<button
											class="agent-picker-item flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors"
											style="color: var(--text); font-family: var(--font-mono);"
											onclick={() => { onAskAgent(agent.name); onclose(); }}
											data-testid="brief-modal-agent-option"
										>
											<span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style="background: var(--success);"></span>
											{agent.name}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
					{#if editing}
						<button
							class="brief-btn brief-btn-secondary"
							onclick={cancelEdit}
							data-testid="brief-modal-cancel"
						>
							{m.cancel()}
						</button>
						<button
							class="brief-btn brief-btn-primary"
							onclick={save}
							disabled={saveStatus === 'saving' || saveStatus === 'conflict' || charCount > MAX_TOTAL}
							data-testid="brief-modal-save"
						>
							{#if saveStatus === 'saving'}
								<Loader size={11} class="animate-spin" />
							{:else if saveStatus === 'saved'}
								<Check size={11} />
								{m.chat_brief_saved()}
							{:else}
								{m.chat_brief_save()}
							{/if}
						</button>
					{:else}
						<button
							class="brief-btn brief-btn-secondary"
							onclick={onclose}
							data-testid="brief-modal-cancel"
						>
							{m.chat_close()}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* ── Dialog shell ─────────────────────────────────── */
	.brief-dialog {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		max-height: 85vh;
	}

	/* ── Header ───────────────────────────────────────── */
	.brief-header {
		border-bottom: 1px solid var(--border);
	}

	.brief-title {
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--text-primary);
		font-family: var(--font-mono);
	}

	.brief-version-badge {
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 9px;
		font-weight: 700;
		font-family: var(--font-mono);
		background: var(--bg-hover);
		color: var(--text-muted);
	}

	.brief-mode-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-muted);
		border: 1px solid var(--border);
		background: transparent;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.brief-mode-btn:hover {
		color: var(--text-primary);
		border-color: var(--text-muted);
	}

	.brief-mode-active {
		background: var(--accent-muted, oklch(0.55 0.10 65));
		color: var(--bg);
		border-color: transparent;
	}

	.brief-mode-active:hover {
		color: var(--bg);
		opacity: 0.85;
	}

	/* ── Body ─────────────────────────────────────────── */
	.brief-body {
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	/* ── Read mode ────────────────────────────────────── */
	.brief-sections-read {
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.brief-read-section {
		position: relative;
	}

	.brief-read-heading {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--accent);
		font-family: var(--font-mono);
		margin-bottom: 6px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}

	.brief-read-content {
		font-size: 12.5px;
		line-height: 1.65;
		color: var(--text-primary);
		font-family: var(--font-mono);
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* ── Empty state ──────────────────────────────────── */
	.brief-empty {
		padding: 48px 24px;
		text-align: center;
	}

	.brief-empty-text {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-muted);
		font-family: var(--font-mono);
		margin-bottom: 8px;
	}

	.brief-empty-hint {
		font-size: 11px;
		color: var(--text-muted);
		opacity: 0.7;
		font-family: var(--font-mono);
		line-height: 1.6;
	}

	/* ── Edit mode ────────────────────────────────────── */
	.brief-sections-edit {
		padding: 16px 24px 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.brief-edit-section {
		display: flex;
		flex-direction: column;
	}

	.brief-label {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		font-family: var(--font-mono);
		margin-bottom: 6px;
	}

	.brief-edit-textarea {
		width: 100%;
		resize: none;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 8px 10px;
		font-size: 12px;
		line-height: 1.6;
		font-family: var(--font-mono);
		background: var(--bg-input, var(--bg-surface));
		color: var(--text-primary);
		outline: none;
		transition: border-color 150ms ease;
		min-height: 40px;
	}

	.brief-edit-textarea:focus {
		border-color: var(--accent);
	}

	.brief-edit-textarea::placeholder {
		color: var(--text-muted);
		opacity: 0.5;
	}

	/* ── Footer ───────────────────────────────────────── */
	.brief-footer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--border);
		padding: 10px 20px;
	}

	.brief-char-count {
		font-size: 9px;
		font-family: var(--font-mono);
		color: var(--text-muted);
		min-height: 14px;
	}

	.brief-char-count.over-limit {
		color: var(--danger, #ef4444);
	}

	.brief-readonly-hint {
		font-size: 9px;
		color: var(--text-muted);
	}

	.brief-alert {
		border-radius: 4px;
		padding: 6px 10px;
		font-size: 10px;
	}

	.brief-alert-error {
		background: var(--danger-bg, rgba(239, 68, 68, 0.1));
		color: var(--danger, #ef4444);
	}

	.brief-alert-warning {
		background: var(--warning-bg, rgba(234, 179, 8, 0.1));
		color: var(--warning, #eab308);
	}

	/* ── Buttons ──────────────────────────────────────── */
	.brief-btn {
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

	.brief-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.brief-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.brief-btn-primary {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
	}

	.brief-btn-secondary {
		background: transparent;
		color: var(--text-muted);
	}

	.agent-picker-item:hover {
		background: color-mix(in oklch, var(--bg-surface) 60%, transparent);
	}
</style>
