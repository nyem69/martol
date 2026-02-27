<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Chat — Martol</title>
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<!-- Header -->
	<header
		class="flex items-center justify-between px-4 py-3"
		style="background: var(--bg-surface); border-bottom: 1px solid var(--border);"
	>
		<h1
			class="text-sm font-bold tracking-widest"
			style="color: var(--accent); font-family: var(--font-mono);"
		>
			MARTOL
		</h1>
		<span class="text-xs" style="color: var(--text-muted);">
			{data.user?.email ?? 'not signed in'}
		</span>
	</header>

	<!-- Chat area placeholder -->
	<main class="flex flex-1 items-center justify-center px-4">
		<div class="text-center">
			<div
				class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg"
				style="background: var(--bg-surface); border: 1px solid var(--border);"
			>
				<span class="text-2xl" style="color: var(--accent); font-family: var(--font-mono);"
					>#</span
				>
			</div>
			<h2 class="text-lg font-semibold" style="color: var(--text);">Martol Chat</h2>
			<p class="mt-1 text-sm" style="color: var(--text-muted);">
				Real-time AI collaboration — coming soon.
			</p>
		</div>
	</main>

	<!-- Input placeholder -->
	<div
		class="px-4 py-3"
		style="background: var(--bg-surface); border-top: 1px solid var(--border);"
	>
		<div
			class="rounded-md px-3 py-2.5 text-sm"
			style="background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); font-family: var(--font-mono);"
		>
			Type a message...
		</div>
	</div>
</div>
