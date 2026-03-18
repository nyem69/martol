<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Send, Paperclip } from '@lucide/svelte';
	import { matchCommands, parseCommand, type SlashCommand } from '$lib/chat/commands';
	import SlashMenu from './SlashMenu.svelte';
	import MentionPopup from './MentionPopup.svelte';
	import type { MentionUser } from '$lib/types/chat';
	import ReplyPreview from './ReplyPreview.svelte';
	import UploadProgress from './UploadProgress.svelte';

	const ALLOWED_TYPES = new Set([
		'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff',
		'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'text/html',
		'application/json', 'text/yaml', 'application/x-yaml', 'application/xml', 'text/xml',
		'message/rfc822', 'application/zip', 'application/gzip',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		'application/vnd.oasis.opendocument.text'
	]);
	const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

	let {
		onSend,
		onTyping,
		onCommand,
		disabled,
		typingNames,
		userRole = 'member',
		onlineUsers,
		replyTo,
		onCancelReply,
		pendingMention = null,
		onMentionConsumed,
		uploadEnabled = false,
		ragEnabled = false,
		onFileProcessing
	}: {
		onSend: (body: string, replyTo?: number) => void;
		onTyping: () => void;
		onCommand?: (command: string, args: string) => void;
		disabled: boolean;
		typingNames: string[];
		userRole?: string;
		onlineUsers?: Map<string, { name: string; role: string }>;
		replyTo?: { dbId: number; senderName: string; body: string } | null;
		onCancelReply?: () => void;
		pendingMention?: string | null;
		onMentionConsumed?: () => void;
		uploadEnabled?: boolean;
		ragEnabled?: boolean;
		onFileProcessing?: (filename: string) => void;
	} = $props();

	let value = $state('');
	let textarea: HTMLTextAreaElement | undefined;
	let fileInput = $state<HTMLInputElement | undefined>();

	// Upload state
	let uploading = $state(false);
	let uploadProgress = $state(0);
	let uploadError = $state('');
	let activeXhr: XMLHttpRequest | null = null;
	let draggingOver = $state(false);

	// Abort in-flight upload when component is destroyed (e.g. room switch)
	$effect(() => {
		return () => { activeXhr?.abort(); };
	});

	// Slash menu state
	let showSlashMenu = $state(false);
	let slashMenuIndex = $state(0);
	let slashMatches = $state<SlashCommand[]>([]);

	// Mention popup state
	let showMentionPopup = $state(false);
	let mentionIndex = $state(0);
	let mentionMatches = $state<MentionUser[]>([]);
	let mentionStart = $state(-1);

	// Insert @mention from OnlineBar click
	$effect(() => {
		if (pendingMention) {
			value = value ? `${value}@${pendingMention} ` : `@${pendingMention} `;
			onMentionConsumed?.();
			textarea?.focus();
		}
	});

	const isViewer = $derived(userRole === 'viewer');
	const canSend = $derived(value.trim().length > 0 && !disabled && !isViewer);

	const typingText = $derived.by(() => {
		if (typingNames.length === 0) return '';
		if (typingNames.length === 1)
			return m.chat_typing_one({ name: typingNames[0] });
		if (typingNames.length === 2)
			return m.chat_typing_two({ name1: typingNames[0], name2: typingNames[1] });
		return m.chat_typing_many({ count: String(typingNames.length) });
	});

	function send() {
		const body = value.trim();
		if (!body || disabled) return;

		// Check if it's a slash command
		const parsed = parseCommand(body);
		if (parsed && onCommand) {
			// /ask is sent as a regular message so the DO can detect and trigger RAG
			if (parsed.command === 'ask') {
				if (!ragEnabled) {
					uploadError = m.rag_disabled_ask();
					setTimeout(() => (uploadError = ''), 6000);
					return;
				}
				onSend(body, replyTo?.dbId);
				value = '';
				showSlashMenu = false;
				resize();
				onCancelReply?.();
				return;
			}
			onCommand(parsed.command, parsed.args);
			value = '';
			showSlashMenu = false;
			resize();
			return;
		}

		onSend(body, replyTo?.dbId);
		value = '';
		showSlashMenu = false;
		resize();
		onCancelReply?.();
	}

	// Keys that should not trigger typing indicator
	const NON_CHARACTER_KEYS = new Set([
		'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab',
		'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
		'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
		'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
	]);

	function onKeydown(e: KeyboardEvent) {
		// Slash menu keyboard navigation
		if (showSlashMenu && slashMatches.length > 0) {
			// Check if user has already typed args after the command name (e.g., "/ask some question")
			const hasArgs = value.startsWith('/') && value.slice(1).includes(' ') && value.slice(1).split(/\s/, 2)[1]?.length > 0;

			if (e.key === 'ArrowUp') {
				e.preventDefault();
				slashMenuIndex = (slashMenuIndex - 1 + slashMatches.length) % slashMatches.length;
				return;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				slashMenuIndex = (slashMenuIndex + 1) % slashMatches.length;
				return;
			}
			if (e.key === 'Tab') {
				e.preventDefault();
				selectSlashCommand(slashMatches[slashMenuIndex]);
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey && !hasArgs) {
				// Only intercept Enter for command selection when no args typed yet
				e.preventDefault();
				selectSlashCommand(slashMatches[slashMenuIndex]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				showSlashMenu = false;
				return;
			}
		}

		// Mention popup keyboard navigation
		if (showMentionPopup && mentionMatches.length > 0) {
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				mentionIndex = (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
				return;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				mentionIndex = (mentionIndex + 1) % mentionMatches.length;
				return;
			}
			if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
				e.preventDefault();
				selectMention(mentionMatches[mentionIndex]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				showMentionPopup = false;
				return;
			}
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		} else if (!NON_CHARACTER_KEYS.has(e.key)) {
			onTyping();
		}
	}

	function selectSlashCommand(cmd: SlashCommand) {
		value = `/${cmd.name} `;
		showSlashMenu = false;
		textarea?.focus();
	}

	function selectMention(user: MentionUser) {
		// Replace from mentionStart to cursor with @name
		const before = value.slice(0, mentionStart);
		const after = value.slice(textarea?.selectionStart ?? value.length);
		value = `${before}@${user.name} ${after}`;
		showMentionPopup = false;
		textarea?.focus();
	}

	function resize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		// Cap at ~6 lines (approx 144px)
		textarea.style.height = Math.min(textarea.scrollHeight, 144) + 'px';
	}

	function onInput() {
		resize();
		updatePopups();
	}

	function updatePopups() {
		const cursorPos = textarea?.selectionStart ?? 0;

		// Check for slash command at start of input
		if (value.startsWith('/') && !value.includes('\n')) {
			const matches = matchCommands(value, userRole);
			slashMatches = matches;
			slashMenuIndex = 0;
			showSlashMenu = true;
			showMentionPopup = false;
			return;
		}
		showSlashMenu = false;

		// Check for @ mention
		if (onlineUsers && cursorPos > 0) {
			const textBeforeCursor = value.slice(0, cursorPos);
			const atIdx = textBeforeCursor.lastIndexOf('@');
			if (atIdx !== -1 && (atIdx === 0 || textBeforeCursor[atIdx - 1] === ' ')) {
				const query = textBeforeCursor.slice(atIdx + 1).toLowerCase();
				const allEntry = 'all'.startsWith(query) ? [{ id: 'all', name: 'all' }] : [];
				const docsEntry = ragEnabled && 'docs'.startsWith(query) ? [{ id: 'docs', name: 'docs' }] : [];
				const matches = [...onlineUsers.entries()]
					.filter(([_, u]) => u.name.toLowerCase().startsWith(query))
					.map(([id, u]) => ({ id, name: u.name }));
				const combined = [...allEntry, ...docsEntry, ...matches].slice(0, 8);
				mentionMatches = combined;
				mentionIndex = 0;
				mentionStart = atIdx;
				showMentionPopup = matches.length > 0;
				return;
			}
		}
		showMentionPopup = false;
	}

	function cancelUpload() {
		activeXhr?.abort();
		activeXhr = null;
		uploading = false;
		uploadProgress = 0;
	}

	let uploadQueue: File[] = [];

	function processNextUpload() {
		if (uploadQueue.length > 0) {
			const next = uploadQueue.shift()!;
			uploadFile(next);
		}
	}

	function uploadFile(file: File) {
		if (uploading) {
			// Queue file for sequential upload
			uploadQueue.push(file);
			return;
		}

		if (!ALLOWED_TYPES.has(file.type)) {
			uploadError = m.chat_upload_type_not_allowed();
			setTimeout(() => (uploadError = ''), 4000);
			return;
		}
		if (file.size > MAX_SIZE) {
			uploadError = m.chat_upload_too_large();
			setTimeout(() => (uploadError = ''), 4000);
			return;
		}

		uploading = true;
		uploadProgress = 0;
		uploadError = '';

		const xhr = new XMLHttpRequest();
		activeXhr = xhr;
		const formData = new FormData();
		formData.append('file', file);

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) uploadProgress = e.loaded / e.total;
		};

		xhr.onload = () => {
			activeXhr = null;
			uploading = false;
			processNextUpload();
			console.log(`[Upload] Response status=${xhr.status}`);
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					const json = JSON.parse(xhr.responseText);
					console.log('[Upload] Server response:', JSON.stringify(json, null, 2));
					if (json.rag) {
						console.log(`[Upload] RAG pipeline: ${json.rag.status} — ${json.rag.reason}`);
						if (json.rag.status === 'queued' && json.filename) {
							onFileProcessing?.(json.filename as string);
						}
					}
					if (json.ok && json.key) {
						// Use server-sanitized filename to avoid markdown injection from raw file.name
						const safeAlt = (json.filename as string).replace(/[[\]]/g, '');
						// Images use ![alt](r2:key), documents use [alt](r2:key)
						const isImage = (json.contentType as string)?.startsWith('image/');
						const marker = isImage
							? `![${safeAlt}](r2:${json.key})`
							: `[${safeAlt}](r2:${json.key})`;
						const pos = textarea?.selectionStart ?? value.length;
						value = value.slice(0, pos) + marker + value.slice(pos);
						resize();
					} else {
						uploadError = m.chat_upload_failed();
						setTimeout(() => (uploadError = ''), 4000);
					}
				} catch {
					uploadError = m.chat_upload_failed();
					setTimeout(() => (uploadError = ''), 4000);
				}
			} else {
				try {
					const errJson = JSON.parse(xhr.responseText);
					if (errJson?.error?.code === 'upload_limit') {
						uploadError = m.chat_upload_limit();
					} else {
						uploadError = m.chat_upload_failed();
					}
				} catch {
					uploadError = m.chat_upload_failed();
				}
				setTimeout(() => (uploadError = ''), 6000);
			}
		};

		xhr.onerror = () => {
			activeXhr = null;
			uploading = false;
			processNextUpload();
			uploadError = m.chat_upload_failed();
			setTimeout(() => (uploadError = ''), 4000);
		};

		xhr.open('POST', '/api/upload');
		xhr.send(formData);
	}

	function onFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (files) {
			for (const file of files) {
				uploadFile(file);
			}
		}
		// Reset so the same file can be re-selected
		input.value = '';
	}

	function onPaste(e: ClipboardEvent) {
		if (!uploadEnabled) return;
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.kind === 'file' && ALLOWED_TYPES.has(item.type)) {
				const file = item.getAsFile();
				if (file) {
					e.preventDefault();
					uploadFile(file);
					return;
				}
			}
		}
	}

	function onDragOver(e: DragEvent) {
		if (!uploadEnabled) return;
		e.preventDefault();
		draggingOver = true;
	}

	function onDragLeave(e: DragEvent) {
		// Only hide when leaving the container (not entering a child)
		if (e.currentTarget && !((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))) {
			draggingOver = false;
		}
	}

	function onDrop(e: DragEvent) {
		if (!uploadEnabled) return;
		e.preventDefault();
		draggingOver = false;
		const files = e.dataTransfer?.files;
		if (files) {
			for (const file of files) {
				uploadFile(file);
			}
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="relative px-4 pt-2"
	style="background: var(--bg-surface); border-top: 1px solid var(--border); padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));"
	role="region"
	aria-label={uploadEnabled ? m.chat_attach_file() : undefined}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	{#if typingText}
		<div class="mb-1.5 text-xs" style="color: var(--text-muted);" aria-live="polite">
			{typingText}
		</div>
	{/if}

	{#if replyTo}
		<ReplyPreview
			senderName={replyTo.senderName}
			body={replyTo.body}
			onCancel={() => onCancelReply?.()}
		/>
	{/if}

	{#if uploading}
		<div class="mb-1.5 flex items-center gap-2">
			<div
				class="h-2 flex-1 overflow-hidden rounded-full"
				style="background: var(--bg-elevated);"
				role="progressbar"
				aria-valuenow={Math.round(uploadProgress * 100)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={m.chat_uploading()}
			>
				<div class="h-full rounded-full transition-all" style="width: {uploadProgress * 100}%; background: var(--accent);"></div>
			</div>
			<span class="shrink-0 text-[10px]" style="color: var(--text-muted);">{Math.round(uploadProgress * 100)}%</span>
			<button onclick={cancelUpload} class="shrink-0 text-[10px] underline" style="color: var(--text-muted);" aria-label={m.chat_dismiss()}>
				{m.chat_dismiss()}
			</button>
		</div>
	{/if}

	{#if uploadError}
		<div class="mb-1.5 flex items-center justify-between text-xs" style="color: var(--danger);" role="alert">
			<span>{uploadError}</span>
			<button onclick={() => (uploadError = '')} class="ml-2 underline" aria-label={m.chat_dismiss()}>{m.chat_dismiss()}</button>
		</div>
	{/if}

	{#if draggingOver && uploadEnabled}
		<div
			class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed"
			style="border-color: var(--accent); background: color-mix(in oklch, var(--accent) 10%, transparent);"
		>
			<span class="text-sm font-medium" style="color: var(--accent);">{m.chat_attach_file()}</span>
		</div>
	{/if}

	<!-- Popup container (positioned relative to input area) -->
	<div class="relative">
		{#if showSlashMenu}
			<SlashMenu
				commands={slashMatches}
				selectedIndex={slashMenuIndex}
				onSelect={selectSlashCommand}
			/>
		{/if}
		{#if showMentionPopup}
			<MentionPopup
				users={mentionMatches}
				selectedIndex={mentionIndex}
				onSelect={selectMention}
			/>
		{/if}

		{#if uploadEnabled}
			<input
				bind:this={fileInput}
				type="file"
				multiple
				accept="image/jpeg,image/png,image/gif,image/webp,image/tiff,application/pdf,text/plain,text/markdown,text/csv,text/html,application/json,text/yaml,application/xml,message/rfc822,application/zip,application/gzip,.docx,.xlsx,.pptx,.odt,.eml,.md,.csv,.json,.yaml,.yml"
				class="hidden"
				onchange={onFileSelect}
				data-testid="file-input"
			/>
		{/if}

		<div
			class="flex items-end gap-2 rounded-lg px-3 py-2"
			style="background: var(--bg); border: 1px solid var(--border);"
		>
			{#if uploadEnabled}
				<button
					onclick={() => fileInput?.click()}
					disabled={disabled || uploading}
					data-testid="attach-button"
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-all hover:opacity-80 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
					style="color: var(--text-muted);"
					aria-label={m.chat_attach_file()}
				>
					<Paperclip size={16} />
				</button>
			{/if}
			<textarea
				bind:this={textarea}
				bind:value
				oninput={onInput}
				onkeydown={onKeydown}
				onpaste={onPaste}
				placeholder={isViewer ? m.chat_viewer_readonly() : m.chat_placeholder()}
				rows="1"
				disabled={disabled || isViewer}
				data-testid="chat-input"
				aria-label={isViewer ? m.chat_viewer_readonly() : m.chat_placeholder()}
				class="flex-1 resize-none border-0 bg-transparent leading-relaxed"
				style="color: var(--text); font-family: var(--font-sans); font-size: 16px; max-height: 144px;{isViewer ? ' opacity: 0.5;' : ''}"
			></textarea>
			<button
				onclick={send}
				disabled={!canSend}
				data-testid="send-button"
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-all hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
				style="background: {canSend
					? 'var(--accent)'
					: 'var(--bg-elevated)'}; color: {canSend ? 'var(--bg)' : 'var(--text-muted)'};"
				aria-label={m.chat_send()}
			>
				<Send size={16} />
			</button>
		</div>
	</div>
</div>
