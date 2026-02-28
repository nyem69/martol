<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Send } from '@lucide/svelte';

	let {
		onSend,
		onTyping,
		disabled,
		typingNames
	}: {
		onSend: (body: string) => void;
		onTyping: () => void;
		disabled: boolean;
		typingNames: string[];
	} = $props();

	let value = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

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
		onSend(body);
		value = '';
		resize();
	}

	// Keys that should not trigger typing indicator
	const NON_CHARACTER_KEYS = new Set([
		'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab',
		'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
		'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
		'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
	]);

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		} else if (!NON_CHARACTER_KEYS.has(e.key)) {
			onTyping();
		}
	}

	function resize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		// Cap at ~6 lines (approx 144px)
		textarea.style.height = Math.min(textarea.scrollHeight, 144) + 'px';
	}

	function onInput() {
		resize();
	}
</script>

<div
	class="px-4 pb-3 pt-2"
	style="background: var(--bg-surface); border-top: 1px solid var(--border);"
>
	{#if typingText}
		<div class="mb-1.5 text-xs" style="color: var(--text-muted);" aria-live="polite">
			{typingText}
		</div>
	{/if}
	<div
		class="flex items-end gap-2 rounded-lg px-3 py-2"
		style="background: var(--bg); border: 1px solid var(--border);"
	>
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
			class="flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed outline-none"
			style="color: var(--text); font-family: var(--font-sans); max-height: 144px;"
		></textarea>
		<button
			onclick={send}
			disabled={!canSend}
			data-testid="send-button"
			class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-opacity"
			style="background: {canSend
				? 'var(--accent)'
				: 'var(--bg-elevated)'}; color: {canSend ? 'var(--bg)' : 'var(--text-muted)'};"
			aria-label={m.chat_send()}
		>
			<Send size={16} />
		</button>
	</div>
</div>
