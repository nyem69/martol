<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Send, ImagePlus } from '@lucide/svelte';
	import { matchCommands, parseCommand, type SlashCommand } from '$lib/chat/commands';
	import SlashMenu from './SlashMenu.svelte';
	import MentionPopup from './MentionPopup.svelte';
	import type { MentionUser } from '$lib/types/chat';
	import ReplyPreview from './ReplyPreview.svelte';
	import UploadProgress from './UploadProgress.svelte';

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
		onUploadImage,
		uploading = false,
		uploadFilename = ''
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
		onUploadImage?: (file: File) => void;
		uploading?: boolean;
		uploadFilename?: string;
	} = $props();

	let value = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();
	let fileInput: HTMLInputElement | undefined = $state();
	let dragging = $state(false);

	const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file && onUploadImage) onUploadImage(file);
		input.value = '';
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file?.type.startsWith('image/') && onUploadImage) onUploadImage(file);
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function handleDragLeave(e: DragEvent) {
		const target = e.currentTarget as Element;
		if (!target.contains(e.relatedTarget as Node)) {
			dragging = false;
		}
	}

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

	const canSend = $derived(value.trim().length > 0 && !disabled);

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
			onCommand(parsed.command, parsed.args);
			value = '';
			resize();
			return;
		}

		onSend(body, replyTo?.dbId);
		value = '';
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
			if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
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
				const matches = [...onlineUsers.entries()]
					.filter(([_, u]) => u.name.toLowerCase().startsWith(query))
					.map(([id, u]) => ({ id, name: u.name }))
					.slice(0, 8);
				mentionMatches = matches;
				mentionIndex = 0;
				mentionStart = atIdx;
				showMentionPopup = matches.length > 0;
				return;
			}
		}
		showMentionPopup = false;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="relative px-4 pt-2"
	style="background: var(--bg-surface); border-top: 1px solid var(--border); padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));{dragging ? ' outline: 2px dashed var(--accent); outline-offset: -2px;' : ''}"
	ondrop={handleDrop}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
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

		<UploadProgress active={uploading} filename={uploadFilename} />

		<input
			bind:this={fileInput}
			type="file"
			accept={IMAGE_ACCEPT}
			class="hidden"
			onchange={handleFileSelect}
			data-testid="file-input"
		/>

		<div
			class="flex items-end gap-2 rounded-lg px-3 py-2"
			style="background: var(--bg); border: 1px solid var(--border);"
		>
			{#if onUploadImage}
				<button
					onclick={() => fileInput?.click()}
					disabled={disabled || uploading}
					data-testid="upload-button"
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
					style="color: var(--text-muted);"
					aria-label={m.upload_attach_image()}
				>
					<ImagePlus size={18} />
				</button>
			{/if}
			<textarea
				bind:this={textarea}
				bind:value
				oninput={onInput}
				onkeydown={onKeydown}
				placeholder={m.chat_placeholder()}
				rows="1"
				{disabled}
				data-testid="chat-input"
				aria-label={m.chat_placeholder()}
				class="flex-1 resize-none border-0 bg-transparent leading-relaxed outline-none"
				style="color: var(--text); font-family: var(--font-sans); font-size: 16px; max-height: 144px;"
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
