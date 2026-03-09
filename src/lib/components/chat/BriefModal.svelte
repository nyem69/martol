<script lang="ts">
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { X, Loader, Check, Bot } from '@lucide/svelte';
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
		onAskAgent
	}: {
		orgId: string;
		currentBrief: string;
		currentVersion: number;
		canEdit: boolean;
		onclose: () => void;
		onAskAgent: (() => void) | null;
	} = $props();

	const MAX_TOTAL = 10_000;

	// svelte-ignore state_referenced_locally — modal is recreated each open, initial value is stable
	let sections = $state<BriefSections>(parseBriefContent(currentBrief));
	// svelte-ignore state_referenced_locally
	let version = $state(currentVersion);
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
	let closeBtn: HTMLButtonElement | undefined;
	let prevFocus: HTMLElement | null = null;
	let dialogEl: HTMLDivElement | undefined;

	const charCount = $derived(totalLength(sections));

	$effect(() => {
		prevFocus = document.activeElement as HTMLElement;
		untrack(() => closeBtn?.focus());
		return () => prevFocus?.focus();
	});

	// i18n label/placeholder resolvers keyed by section key
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
				setTimeout(() => { if (saveStatus === 'saved') saveStatus = 'idle'; }, 2000);
			} else if (res.status === 409) {
				saveStatus = 'conflict';
				// Reload brief
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

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
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
		class="relative z-10 flex w-full max-w-lg flex-col rounded-lg"
		style="background: var(--bg-surface); border: 1px solid var(--border); max-height: 85vh;"
	>
		<!-- Header -->
		<div class="flex items-center justify-between border-b px-5 py-3" style="border-color: var(--border);">
			<div class="flex items-center gap-2">
				<h2 class="text-sm font-bold" style="color: var(--text-primary); font-family: var(--font-mono);">
					{m.chat_brief_modal_title()}
				</h2>
				<span class="rounded px-1.5 py-0.5 text-[9px] font-bold" style="background: var(--bg-hover); color: var(--text-muted); font-family: var(--font-mono);">
					v{version}
				</span>
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

		<!-- Body — scrollable -->
		<div class="flex-1 overflow-y-auto px-5 py-4" style="scrollbar-width: thin;">
			<div class="flex flex-col gap-4">
				{#each SECTION_META as sec}
					<div>
						<label
							for="brief-{sec.key}"
							class="mb-1 block text-[10px] font-bold uppercase tracking-wider"
							style="color: var(--text-muted); font-family: var(--font-mono);"
						>
							{labelFn[sec.key]()}
						</label>
						<textarea
							id="brief-{sec.key}"
							bind:value={sections[sec.key]}
							placeholder={placeholderFn[sec.key]()}
							disabled={!canEdit}
							rows={sec.rows}
							class="brief-section-textarea"
							data-testid="brief-section-{sec.key}"
						></textarea>
					</div>
				{/each}
			</div>
		</div>

		<!-- Footer -->
		<div class="flex flex-col gap-2 border-t px-5 py-3" style="border-color: var(--border);">
			{#if saveStatus === 'error'}
				<div class="rounded px-2 py-1.5 text-[10px]" style="background: var(--danger-bg, rgba(239,68,68,0.1)); color: var(--danger, #ef4444);" role="alert">
					{m.chat_brief_save_error()}
				</div>
			{:else if saveStatus === 'conflict'}
				<div class="rounded px-2 py-1.5 text-[10px]" style="background: var(--warning-bg, rgba(234,179,8,0.1)); color: var(--warning, #eab308);" role="alert">
					{m.chat_brief_conflict()}
				</div>
			{/if}
			<div class="flex items-center justify-between">
				<span
					class="text-[9px]"
					style="color: {charCount > MAX_TOTAL ? 'var(--danger, #ef4444)' : 'var(--text-muted)'}; font-family: var(--font-mono);"
				>
					{charCount.toLocaleString()}/{MAX_TOTAL.toLocaleString()}
				</span>

				<div class="flex items-center gap-2" aria-live="polite">
					{#if !canEdit}
						<span class="text-[9px]" style="color: var(--text-muted);">
							{m.chat_brief_readonly_hint()}
						</span>
					{/if}
					{#if onAskAgent}
						<button
							class="brief-btn brief-btn-secondary"
							onclick={() => { onAskAgent?.(); onclose(); }}
							data-testid="brief-modal-ask-agent"
						>
							<Bot size={12} />
							{m.chat_brief_ask_agent()}
						</button>
					{/if}
					<button
						class="brief-btn brief-btn-secondary"
						onclick={onclose}
						data-testid="brief-modal-cancel"
					>
						{m.cancel()}
					</button>
					{#if canEdit}
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
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.brief-section-textarea {
		width: 100%;
		resize: vertical;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 8px 10px;
		font-size: 12px;
		line-height: 1.5;
		font-family: var(--font-mono);
		background: var(--bg-input, var(--bg-surface));
		color: var(--text-primary);
		outline: none;
		transition: border-color 150ms ease;
	}

	.brief-section-textarea:focus {
		border-color: var(--accent);
	}

	.brief-section-textarea::placeholder {
		color: var(--text-muted);
		opacity: 0.6;
	}

	.brief-section-textarea:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

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
</style>
