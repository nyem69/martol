<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Menu, ChevronDown, Plus, Loader, User, Settings, LogOut } from '@lucide/svelte';
	import { organization, signOut } from '$lib/auth-client';
	import { invalidateAll, goto } from '$app/navigation';

	let {
		roomName,
		roomId,
		rooms,
		userName,
		onlineCount,
		onToggleMembers
	}: {
		roomName: string;
		roomId: string;
		rooms: Array<{ id: string; name: string }>;
		userName: string;
		onlineCount: number;
		onToggleMembers: () => void;
	} = $props();

	let dropdownOpen = $state(false);
	let userMenuOpen = $state(false);
	let creating = $state(false);
	let newRoomName = $state('');
	let createLoading = $state(false);

	function toggleDropdown() {
		dropdownOpen = !dropdownOpen;
		if (!dropdownOpen) creating = false;
	}

	function closeDropdown() {
		dropdownOpen = false;
		creating = false;
	}

	function toggleUserMenu() {
		userMenuOpen = !userMenuOpen;
	}

	function closeUserMenu() {
		userMenuOpen = false;
	}

	async function handleSignOut() {
		closeUserMenu();
		await signOut();
		goto('/login');
	}

	async function switchRoom(orgId: string) {
		if (orgId === roomId) {
			closeDropdown();
			return;
		}
		await organization.setActive({ organizationId: orgId });
		closeDropdown();
		await invalidateAll();
	}

	async function createRoom() {
		const name = newRoomName.trim();
		if (!name || createLoading) return;
		createLoading = true;
		try {
			const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
			const res = await organization.create({ name, slug });
			// Set the new org as active so the chat page loads it
			if (res.data?.id) {
				await organization.setActive({ organizationId: res.data.id });
			}
			newRoomName = '';
			closeDropdown();
			await invalidateAll();
		} finally {
			createLoading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			closeDropdown();
			closeUserMenu();
		}
	}
</script>

<svelte:window onkeydown={dropdownOpen || userMenuOpen ? handleKeydown : undefined} />

<header
	class="z-10 flex shrink-0 items-center justify-between px-4 py-3"
	style="background: var(--bg-elevated); border-bottom: 1px solid var(--border); padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));"
>
{#if dropdownOpen}
	<button
		class="fixed inset-0 z-20"
		onclick={closeDropdown}
		aria-label="Close dropdown"
		tabindex="-1"
	></button>
{/if}
	<div class="relative flex items-center gap-2">
		<span
			class="text-sm font-bold tracking-widest"
			style="color: var(--accent); font-family: var(--font-mono);"
		>
			MARTOL
		</span>
		<span class="text-xs" style="color: var(--text-muted);">/</span>
		<button
			class="room-switcher-btn flex items-center gap-1 rounded px-1.5 py-0.5 text-sm font-medium transition-colors"
			onclick={toggleDropdown}
			aria-expanded={dropdownOpen}
			aria-haspopup="listbox"
			data-testid="room-switcher"
		>
			<span style="color: var(--text);">{roomName}</span>
			<span
				class="transition-transform duration-150"
				style="color: var(--text-muted); transform: rotate({dropdownOpen ? '180' : '0'}deg);"
			>
				<ChevronDown size={14} />
			</span>
		</button>

		{#if dropdownOpen}
			<div
				class="room-dropdown absolute top-full left-0 z-30 mt-1 min-w-56 rounded-lg border shadow-xl"
				style="background: var(--bg-elevated); border-color: var(--border);"
				role="listbox"
				aria-label={m.chat_room_switch()}
			>
				{#each rooms as room (room.id)}
					<button
						class="room-item flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
						style="color: {room.id === roomId ? 'var(--accent)' : 'var(--text)'};"
						onclick={() => switchRoom(room.id)}
						role="option"
						aria-selected={room.id === roomId}
						data-testid="room-option"
					>
						{#if room.id === roomId}
							<span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style="background: var(--accent);"></span>
						{:else}
							<span class="inline-block h-1.5 w-1.5 shrink-0"></span>
						{/if}
						<span class="truncate">{room.name}</span>
					</button>
				{/each}

				<div style="border-top: 1px solid var(--border);">
					{#if creating}
						<form
							class="flex items-center gap-1.5 px-3 py-2"
							onsubmit={(e) => { e.preventDefault(); createRoom(); }}
						>
							<input
								type="text"
								bind:value={newRoomName}
								placeholder={m.chat_room_name_placeholder()}
								class="create-room-input flex-1"
								data-testid="create-room-input"
								autofocus
							/>
							<button
								type="submit"
								class="create-room-submit"
								disabled={createLoading || !newRoomName.trim()}
								data-testid="create-room-submit"
							>
								{#if createLoading}
									<Loader size={12} class="animate-spin" />
								{:else}
									<Plus size={12} />
								{/if}
							</button>
						</form>
					{:else}
						<button
							class="room-item flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
							style="color: var(--accent);"
							onclick={() => (creating = true)}
							data-testid="create-room-btn"
						>
							<Plus size={14} />
							<span>{m.chat_room_create()}</span>
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
	<div class="flex items-center gap-3">
		{#if onlineCount > 0}
			<div class="flex items-center gap-1.5" aria-live="polite">
				<span
					class="inline-block h-2 w-2 rounded-full"
					style="background: var(--success);"
					aria-hidden="true"
				></span>
				<span class="text-xs" style="color: var(--text-muted);">
					{m.chat_online({ count: String(onlineCount) })}
				</span>
			</div>
		{/if}
		<div class="relative">
			<button
				class="user-btn flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors"
				onclick={toggleUserMenu}
				aria-expanded={userMenuOpen}
				aria-haspopup="menu"
				data-testid="user-menu-btn"
			>
				<User size={14} />
				<span style="color: var(--text); font-family: var(--font-mono);">{userName}</span>
			</button>
			{#if userMenuOpen}
				<button
					class="fixed inset-0 z-20"
					onclick={closeUserMenu}
					aria-label="Close menu"
					tabindex="-1"
				></button>
				<div
					class="user-dropdown absolute right-0 top-full z-30 mt-1 min-w-40 rounded-lg border shadow-xl"
					style="background: var(--bg-elevated); border-color: var(--border);"
					role="menu"
				>
					<a
						href="/settings"
						class="menu-item flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
						style="color: var(--text);"
						role="menuitem"
						onclick={closeUserMenu}
					>
						<Settings size={14} />
						<span>{m.nav_settings()}</span>
					</a>
					<div style="border-top: 1px solid var(--border);">
						<button
							class="menu-item flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
							style="color: var(--error);"
							onclick={handleSignOut}
							role="menuitem"
						>
							<LogOut size={14} />
							<span>{m.auth_sign_out()}</span>
						</button>
					</div>
				</div>
			{/if}
		</div>
		<button
			class="rounded p-1.5 transition-opacity hover:opacity-70 active:scale-95"
			style="color: var(--text-muted);"
			onclick={onToggleMembers}
			aria-label={m.chat_toggle_members()}
			data-testid="toggle-members"
		>
			<Menu size={18} />
		</button>
	</div>
</header>

<style>
	.room-switcher-btn:hover {
		background: color-mix(in oklch, var(--bg-surface) 50%, transparent);
	}

	.room-item:hover {
		background: color-mix(in oklch, var(--bg-surface) 60%, transparent);
	}

	.create-room-input {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		padding: 0.25rem 0.5rem;
		font-size: 12px;
		font-family: var(--font-mono);
		color: var(--text);
		outline: none;
	}

	.create-room-input:focus {
		border-color: var(--accent);
	}

	.create-room-input::placeholder {
		color: var(--text-muted);
	}

	.create-room-submit {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		color: var(--bg);
		border: none;
		border-radius: 0.375rem;
		padding: 0.25rem;
		cursor: pointer;
		transition: opacity 150ms ease;
	}

	.create-room-submit:hover:not(:disabled) {
		opacity: 0.85;
	}

	.create-room-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Room dropdown: constrain height on small screens */
	.room-dropdown {
		max-height: 60vh;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.user-btn {
		color: var(--text-muted);
	}

	.user-btn:hover {
		background: color-mix(in oklch, var(--bg-surface) 50%, transparent);
	}

	.user-dropdown {
		max-height: 60vh;
		overflow-y: auto;
	}

	.menu-item:hover {
		background: color-mix(in oklch, var(--bg-surface) 60%, transparent);
	}

	/* Touch devices: larger tap targets */
	@media (hover: none) {
		.room-item {
			padding-top: 0.625rem;
			padding-bottom: 0.625rem;
		}

		.room-switcher-btn {
			padding: 0.375rem 0.5rem;
		}
	}
</style>
